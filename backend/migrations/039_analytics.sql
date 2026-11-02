-- ---------------------------------------------------------------------------
-- 039 · The analytics sink (build-plan M21 slice 5)
--
-- mobile/src/lib/analytics.ts has emitted the typed client events from the
-- data plan since the foundation, into a console transport. This is where
-- they land: POST /v1/client/analytics, one row per event, kept 90 days and
-- exported nightly to a PRIVATE bucket as gzipped NDJSON.
--
-- Two rules, both about trust:
--
--   1. The client's word is never the money's word. A purchase, a gift, a
--      room hour — the metrics read those from purchases, gift_sends and
--      room_sessions, which the ledger wrote. Client events answer only what
--      the server cannot see: that an app was opened, a screen viewed, a card
--      tapped. A tampered client can inflate its own "app_opened"; it cannot
--      inflate revenue.
--   2. user_id comes from the access token, never from the event body.
--
-- Partitioned by IST day so retention is DROP TABLE on a whole day, not a
-- DELETE scanning millions of rows, and so a day's query reads one partition.
-- ---------------------------------------------------------------------------

CREATE TABLE analytics_events (
  id           uuid        NOT NULL,
  occurred_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  -- The data plan's object_action, past tense. A token, not an allowlist: a
  -- new event must not need a backend release.
  event        text        NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]{1,63}$'),
  user_id      uuid,
  device_id    text        CHECK (length(device_id) <= 128),
  session_id   text        CHECK (length(session_id) <= 64),
  app_version  text        CHECK (length(app_version) <= 32),
  platform     text        CHECK (platform IN ('android', 'ios', 'web')),
  app_update   text        CHECK (length(app_update) <= 64),
  -- Primitives only, sanitised by key name before insert (infra/eventLog.ts).
  props        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);

-- Anything outside the partitions that exist. Should stay empty: the service
-- clamps occurred_at to the last 7 days, and partitions are kept 7 days ahead.
-- A row here means the maintenance job stopped running.
CREATE TABLE analytics_events_default PARTITION OF analytics_events DEFAULT;

CREATE INDEX analytics_events_event_idx  ON analytics_events (event, occurred_at);
CREATE INDEX analytics_events_device_idx ON analytics_events (device_id, occurred_at);
CREATE INDEX analytics_events_user_idx   ON analytics_events (user_id, occurred_at) WHERE user_id IS NOT NULL;

COMMENT ON TABLE analytics_events IS
  'Client analytics events, partitioned by IST day, kept 90 days (analytics_drop_partitions). '
  'Never the source of a money number: purchases, gift_sends and room_sessions are.';

-- ── Partition maintenance ──────────────────────────────────────────────────
--
-- SECURITY DEFINER because the app role owns nothing and can create nothing
-- (ops/roles.sql). These run with the migration owner's rights and can do
-- exactly one thing each: create a day's partition, or drop old ones.

CREATE OR REPLACE FUNCTION analytics_ensure_partitions(days_back int, days_ahead int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date;
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  created int := 0;
  name text;
BEGIN
  IF days_back < 0 OR days_back > 30 OR days_ahead < 0 OR days_ahead > 30 THEN
    RAISE EXCEPTION 'analytics_ensure_partitions: days out of range';
  END IF;
  FOR d IN SELECT generate_series(today - days_back, today + days_ahead, interval '1 day')::date LOOP
    name := 'analytics_events_' || to_char(d, 'YYYYMMDD');
    IF to_regclass(name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
        name,
        (d::timestamp AT TIME ZONE 'Asia/Kolkata'),
        ((d + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION analytics_drop_partitions(keep_days int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  part record;
  cutoff date := (now() AT TIME ZONE 'Asia/Kolkata')::date - keep_days;
  dropped int := 0;
BEGIN
  IF keep_days < 7 THEN
    RAISE EXCEPTION 'analytics_drop_partitions: refusing to keep fewer than 7 days';
  END IF;
  FOR part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'analytics_events'::regclass
       AND c.relname ~ '^analytics_events_[0-9]{8}$'
  LOOP
    IF to_date(right(part.relname, 8), 'YYYYMMDD') < cutoff THEN
      EXECUTE format('DROP TABLE %I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;

-- Two weeks back (an app reporting late after a long offline stretch) and a
-- week ahead, from the moment the table exists.
SELECT analytics_ensure_partitions(7, 7);

-- ── The numbers (read by /admin/metrics) ───────────────────────────────────
--
-- Views, not tables: at this scale a day's numbers are a scan of one
-- partition and three indexed tables. Materialise them when they get slow.

-- Active people per IST day: anyone who sent any event. Devices count people
-- who never signed in; signed_in counts accounts.
CREATE VIEW analytics_daily_active AS
SELECT (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(DISTINCT device_id)                      AS devices,
       count(DISTINCT user_id)                        AS signed_in
  FROM analytics_events
 GROUP BY 1;

-- A day, step by step, from app opened to first gift. Each step is "people
-- who did this on the day", not a strict cohort: the early steps are devices
-- (a person has no account yet), the money steps are accounts read from the
-- ledger's own tables. Answers the M21 exit criterion in one call:
--   SELECT * FROM analytics_funnel(current_date - 1);
CREATE OR REPLACE FUNCTION analytics_funnel(day date)
RETURNS TABLE (step int, name text, people bigint)
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    SELECT (day::timestamp AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  )
  SELECT 1, 'opened the app', count(DISTINCT device_id)
    FROM analytics_events, bounds
   WHERE event = 'app_opened' AND occurred_at >= lo AND occurred_at < hi
  UNION ALL
  SELECT 2, 'signed up', count(DISTINCT coalesce(user_id::text, device_id))
    FROM analytics_events, bounds
   WHERE event = 'signup_completed' AND occurred_at >= lo AND occurred_at < hi
  UNION ALL
  SELECT 3, 'opened a room', count(DISTINCT device_id)
    FROM analytics_events, bounds
   WHERE event IN ('room_card_tapped', 'room_joined') AND occurred_at >= lo AND occurred_at < hi
  UNION ALL
  SELECT 4, 'first purchase', count(*)
    FROM (SELECT user_id, min(credited_at) AS first_at
            FROM purchases WHERE status = 'credited' GROUP BY user_id) p, bounds
   WHERE p.first_at >= lo AND p.first_at < hi
  UNION ALL
  SELECT 5, 'first gift', count(*)
    FROM (SELECT sender_user_id, min(created_at) AS first_at
            FROM gift_sends GROUP BY sender_user_id) g, bounds
   WHERE g.first_at >= lo AND g.first_at < hi
  ORDER BY 1;
$$;

-- Money per IST day, from the ledger's tables only.
CREATE VIEW analytics_daily_money AS
WITH days AS (
  SELECT generate_series(
           (now() AT TIME ZONE 'Asia/Kolkata')::date - 89,
           (now() AT TIME ZONE 'Asia/Kolkata')::date,
           interval '1 day')::date AS day
),
payers AS (
  SELECT (credited_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         count(DISTINCT user_id) AS payers,
         sum(amount_paise)       AS gross_paise
    FROM purchases WHERE status = 'credited' GROUP BY 1
),
gifts AS (
  SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         count(*)   AS gifts,
         sum(coins) AS coins
    FROM gift_sends GROUP BY 1
),
hours AS (
  SELECT (started_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
         sum(extract(epoch FROM coalesce(ended_at, now()) - started_at)) / 3600.0 AS room_hours
    FROM room_sessions GROUP BY 1
)
SELECT d.day,
       coalesce(p.payers, 0)                     AS payers,
       coalesce(p.gross_paise, 0)                AS gross_paise,
       coalesce(a.signed_in, 0)                  AS active_accounts,
       CASE WHEN coalesce(a.signed_in, 0) = 0 THEN NULL
            ELSE round(10000.0 * coalesce(p.payers, 0) / a.signed_in) END AS payer_rate_bp,
       coalesce(g.gifts, 0)                      AS gifts,
       coalesce(g.coins, 0)                      AS gift_coins,
       round(coalesce(h.room_hours, 0)::numeric, 1) AS room_hours,
       CASE WHEN coalesce(h.room_hours, 0) = 0 THEN NULL
            ELSE round((coalesce(g.coins, 0) / h.room_hours)::numeric) END AS coins_per_room_hour
  FROM days d
  LEFT JOIN payers p ON p.day = d.day
  LEFT JOIN gifts  g ON g.day = d.day
  LEFT JOIN hours  h ON h.day = d.day
  LEFT JOIN analytics_daily_active a ON a.day = d.day;

-- Did they come back? Devices by the IST day first seen, and how many sent
-- any event one day and seven days later.
CREATE VIEW analytics_retention AS
WITH seen AS (
  SELECT device_id, (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day
    FROM analytics_events
   WHERE device_id IS NOT NULL
   GROUP BY 1, 2
),
first_seen AS (
  SELECT device_id, min(day) AS cohort FROM seen GROUP BY 1
)
SELECT f.cohort,
       count(*) AS devices,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM seen s WHERE s.device_id = f.device_id AND s.day = f.cohort + 1)) AS d1,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM seen s WHERE s.device_id = f.device_id AND s.day = f.cohort + 7)) AS d7
  FROM first_seen f
 GROUP BY f.cohort;

INSERT INTO app_config (key, value, description) VALUES
  ('analytics',
   '{"retentionDays": 90, "partitionsAhead": 7}'::jsonb,
   'Client analytics: days of raw events kept in Postgres (the nightly export to the private bucket keeps them after), and how many days of partitions exist ahead of today.')
ON CONFLICT (key) DO NOTHING;
