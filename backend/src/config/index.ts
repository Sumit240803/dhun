import { z } from 'zod';

/** An env var left blank in a deploy's env file (KEY=) means unset, not an empty value. */
const blankIsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Behind a load balancer req.ip is the proxy unless this is set, and every
  // IP-based rate limit would then throttle the whole fleet as one caller.
  TRUST_PROXY: z.string().default('false'),
  // Comma-separated allowlist for the web portal and admin panel. No wildcard:
  // the API is credentialed, so '*' is both invalid and a genuine hole.
  CORS_ORIGINS: z.string().default(''),
  // Caps a runaway query so one bad plan cannot exhaust the pool.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(10_000),
  // Connections this PROCESS may hold. Three processes share one database, and
  // a managed Postgres caps connections by size (DigitalOcean's 1 GB node
  // allows 22 for the app). 20 each would be 60 against a ceiling of 22, and
  // the third process to start would fail to connect. Set per process by the
  // deploy (infra/) — the default suits one process on a laptop.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(20_000),
  MAX_BODY_BYTES: z.coerce.number().default(262_144),
  // memory: one process, counters lost on restart (development, tests).
  // redis: shared by every instance and kept across deploys (staging, prod).
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
  // The flood ceiling per IP per minute. 600 in production. Staging raises it
  // so ONE machine can generate a load test's traffic (scripts/loadtest-gifts.ts);
  // real users arrive from many addresses, so production never needs to.
  GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(60).max(100_000).default(600),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  // console = print the code to the log (development only).
  // msg91 = the real sender, which needs TRAI DLT registration completed first.
  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  // 'none' is deliberately the default: an unconfigured deploy should fail
  // loudly on the first send rather than silently swallow every verification.
  EMAIL_PROVIDER: z.enum(['console', 'none']).default('none'),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().default(30),
  EMAIL_CODES_PER_HOUR: z.coerce.number().default(5),
  OTP_TTL_MINUTES: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_PER_PHONE_PER_HOUR: z.coerce.number().default(5),

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  // stub = accept a well-formed token without calling the store (dev/test only).
  // google_play = the real Play Developer API, needs a service account.
  IAP_PROVIDER: z.enum(['stub', 'google_play']).default('stub'),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // ── RTC (LiveKit) ────────────────────────────────────────────────────────
  //
  // All optional, so a machine without LiveKit still boots and serves every
  // other endpoint. What is NOT optional is the pair: a URL without the
  // credentials is a half-configured deploy that would fail at the first join
  // rather than at startup, which is checked below.
  //
  // The SECRET signs join tokens and every admin call. It is the equivalent of
  // the JWT secret for the media plane: whoever holds it can mint a token to
  // speak in any room as anyone. It never leaves this process.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('dhun-media'),
  // What the public internet calls the bucket. The r2.dev subdomain to start
  // with; a custom domain before launch, which is why nothing stores a URL it
  // cannot recompute.
  R2_PUBLIC_URL: z.string().optional(),
  R2_UPLOAD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  // The PRIVATE bucket the nightly analytics export writes to. Must differ from
  // R2_BUCKET, which is public; the export refuses to run if they match.
  ANALYTICS_BUCKET: blankIsUnset(z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/)),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  // Short by design. A join token is redeemed within seconds of being issued;
  // a long-lived one is a standing invitation to a room the user may since have
  // been banned from.
  LIVEKIT_TOKEN_TTL_MINUTES: z.coerce.number().min(1).max(60).default(10),
  // Seconds. A slow media server must not hold an API request open — the seat
  // the user tapped either works quickly or reports a failure they can retry.
  LIVEKIT_REQUEST_TIMEOUT_SECONDS: z.coerce.number().min(1).max(30).default(8),
  // How long LiveKit keeps a room alive after the last participant leaves.
  // A host whose train enters a tunnel should come back to their room, not to
  // a dead one with the audience gone.
  LIVEKIT_EMPTY_TIMEOUT_SECONDS: z.coerce.number().min(10).max(1800).default(120),

  // ── Push ─────────────────────────────────────────────────────────────────
  //
  // console = log each notification (development and tests).
  // expo    = Expo's push service, which fronts FCM and APNs. Android delivery
  //           additionally needs FCM credentials uploaded to the Expo project.
  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  // Optional. Required only once "enhanced push security" is turned on for the
  // Expo project; without it anyone holding a token could push to that phone.
  EXPO_ACCESS_TOKEN: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  RTC_APP_ID: z.string().optional(),
  RTC_SERVER_SECRET: z.string().optional(),

  // ── Alerts (infra/alerts.ts) ──────────────────────────────────────────────
  //
  // All optional: with none set, alerts are log lines and event-log rows only.
  // The bot token and the webhook URL are credentials — whoever holds one can
  // post into the channel — and are never logged or echoed.
  ALERT_TELEGRAM_BOT_TOKEN: blankIsUnset(z.string()),
  ALERT_TELEGRAM_CHAT_ID: blankIsUnset(z.string().regex(/^-?\d{1,20}$/, 'A numeric Telegram chat id')),
  ALERT_WEBHOOK_URL: blankIsUnset(z.string().url().startsWith('https://')),
  // "staging" / "prod" in the message, so a phone can tell them apart.
  ALERT_ENV_LABEL: blankIsUnset(z.string().max(20)),
  // Where the admin panel lives, for the link at the end of a message.
  ALERT_LINK_BASE: blankIsUnset(z.string().url()),
});

const env = schema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  trustProxy:
    env.TRUST_PROXY === 'true'
      ? true
      : /^\d+$/.test(env.TRUST_PROXY)
        ? Number(env.TRUST_PROXY)
        : env.TRUST_PROXY === 'false'
          ? false
          : env.TRUST_PROXY,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  dbStatementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  dbPoolMax: env.DB_POOL_MAX,
  requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  maxBodyBytes: env.MAX_BODY_BYTES,
  rateLimitStore: env.RATE_LIMIT_STORE,
  globalRateLimitPerMinute: env.GLOBAL_RATE_LIMIT_PER_MINUTE,

  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,

  auth: {
    jwtSecret: env.JWT_SECRET,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },

  email: {
    provider: env.EMAIL_PROVIDER,
    // Longer than an SMS code's ten minutes: an email sits in an inbox someone
    // checks on their own schedule, and a code that expires before they open it
    // just generates another send.
    codeTtlMinutes: env.EMAIL_CODE_TTL_MINUTES,
    codesPerHour: env.EMAIL_CODES_PER_HOUR,
  },

  otp: {
    provider: env.OTP_PROVIDER,
    ttlMinutes: env.OTP_TTL_MINUTES,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    perPhonePerHour: env.OTP_PER_PHONE_PER_HOUR,
  },

  msg91: {
    authKey: env.MSG91_AUTH_KEY,
    senderId: env.MSG91_SENDER_ID,
    templateId: env.MSG91_TEMPLATE_ID,
  },

  iap: {
    provider: env.IAP_PROVIDER,
    playPackageName: env.GOOGLE_PLAY_PACKAGE_NAME,
    playServiceAccountJson: env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  },

  push: {
    provider: env.PUSH_PROVIDER,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  },

  media: {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.R2_PUBLIC_URL?.replace(/\/+$/, ''),
    uploadTtlMinutes: env.R2_UPLOAD_TTL_MINUTES,

    /**
     * Everything needed to issue an upload AND to read it back afterwards.
     *
     * The public URL is part of the check on purpose: credentials alone would
     * let the server hand out an upload for an object nobody can then fetch,
     * which fails later and further away, in the app, as a broken image.
     */
    get configured(): boolean {
      return Boolean(
        env.R2_ACCOUNT_ID &&
          env.R2_ACCESS_KEY_ID &&
          env.R2_SECRET_ACCESS_KEY &&
          env.R2_PUBLIC_URL,
      );
    },
  },

  livekit: {
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    tokenTtlMinutes: env.LIVEKIT_TOKEN_TTL_MINUTES,
    requestTimeoutSeconds: env.LIVEKIT_REQUEST_TIMEOUT_SECONDS,
    emptyTimeoutSeconds: env.LIVEKIT_EMPTY_TIMEOUT_SECONDS,
    /**
     * All three present. Checked once, here, rather than at every call site —
     * and it is what lets the rest of the app boot on a machine with no media
     * server while every RTC endpoint answers a clean 503.
     */
    get configured(): boolean {
      return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
    },
  },

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
  },

  rtc: { appId: env.RTC_APP_ID, serverSecret: env.RTC_SERVER_SECRET },

  archive: {
    bucket: env.ANALYTICS_BUCKET,
  },

  alerts: {
    telegramBotToken: env.ALERT_TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: env.ALERT_TELEGRAM_CHAT_ID || undefined,
    webhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    envLabel: env.ALERT_ENV_LABEL || env.NODE_ENV,
    linkBase: env.ALERT_LINK_BASE || undefined,
  },
};
