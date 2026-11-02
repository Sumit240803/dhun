#!/bin/sh
# Which process this container is. One image, chosen by the first argument.
#
#   api                 the REST API and the admin panel        (port 3000)
#   gateway             the realtime WebSocket gateway          (port 3001)
#   worker              the scheduler: outbox, reconciliation, purges, alerts
#   worker-run <job>    run one scheduled job once and exit
#   migrate             apply pending migrations, then the grants, and exit
#   migrate-status      list applied and pending migrations
#   grants              apply ops/roles.sql only
#   staff <command>     list | create | reset | revoke staff accounts (scripts/staff.ts)
#   loadtest-seed       accounts and a room for scripts/loadtest-gifts.ts (refuses production)
#
# Migrations and grants run as MIGRATION_DATABASE_URL — the database owner —
# when it is set, and the app as DATABASE_URL, a role that owns nothing and
# cannot UPDATE or DELETE a ledger entry (ops/roles.sql). Locally there is one
# role and MIGRATION_DATABASE_URL is unset, so both fall back to DATABASE_URL.
#
# `exec` so Node replaces this shell and receives signals from tini directly.
set -eu

cmd="${1:-api}"
[ "$#" -gt 0 ] && shift

owner_url="${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}"

grants() {
  if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
    echo "grants: MIGRATION_DATABASE_URL is not set; skipping (local single-role database)" >&2
    return 0
  fi
  psql "$MIGRATION_DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -v app_role="${APP_DB_ROLE:-dhun_app}" -f build/ops/roles.sql
  echo "grants: applied for role ${APP_DB_ROLE:-dhun_app}"
}

case "$cmd" in
  api)            exec node build/src/server.js "$@" ;;
  gateway)        exec node build/src/gateway/index.js "$@" ;;
  worker)         exec node build/src/workers/index.js "$@" ;;
  worker-run)     exec node build/src/workers/index.js --run "$@" ;;
  migrate)
    DATABASE_URL="$owner_url" node build/scripts/migrate.js "$@"
    grants
    ;;
  migrate-status) DATABASE_URL="$owner_url" exec node build/scripts/migrate.js --status "$@" ;;
  grants)         grants ;;
  staff)          exec node build/scripts/staff.js "$@" ;;
  loadtest-seed)  exec node build/scripts/loadtest-seed.js "$@" ;;
  *)
    echo "unknown command: $cmd (expected api | gateway | worker | worker-run <job> | migrate | migrate-status | grants | staff | loadtest-seed)" >&2
    exit 64
    ;;
esac
