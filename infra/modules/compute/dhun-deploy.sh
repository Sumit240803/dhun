#!/usr/bin/env bash
# dhun-deploy — the only way a release reaches this host.
#
# Installed by cloud-init at /usr/local/bin/dhun-deploy. The `deploy` user may
# run it with sudo and nothing else. The pipeline (.github/workflows/deploy.yml)
# calls it over SSH; a person can call it the same way.
#
#   dhun-deploy env                  stdin → /etc/dhun/app.env (0600)
#   dhun-deploy pull <image>         stdin "<user> <token>" → docker login, pull, logout
#   dhun-deploy migrate <image>      migrations + grants (only where DHUN_RUNS_MIGRATIONS=true)
#   dhun-deploy release <image>      switch every service on this host, wait healthy, roll back on failure
#   dhun-deploy rollback             return to the previous release
#   dhun-deploy status               what is running
#
# Order inside a release: worker, then api, then gateway. The worker first so
# the outbox keeps draining on the new code before the API starts writing to
# it; the gateway last because restarting it drops every socket (clients
# reconnect with backoff), so it should only ever restart once the rest is
# known good. In prod the gateway lives on its own host, and the pipeline
# releases that host after the API host is healthy.

set -euo pipefail

ETC=/etc/dhun
# shellcheck disable=SC1091
source "$ETC/host.env"   # DHUN_ENV, DHUN_SERVICES, DHUN_RUNS_MIGRATIONS

log() { printf '%s dhun-deploy: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

valid_image() {
  # A registry reference pinned to a digest or a 40-char sha tag. Never :latest —
  # a rollback to "latest" is not a rollback.
  [[ "$1" =~ ^[a-z0-9./_-]+(:[a-f0-9]{7,40}|@sha256:[a-f0-9]{64})$ ]] || die "refusing image reference: $1"
}

order() {
  local svc
  for svc in worker api gateway; do
    [[ " $DHUN_SERVICES " == *" $svc "* ]] && echo "$svc"
  done
}

healthy() {
  local svc="$1" deadline=$((SECONDS + 90))
  while ((SECONDS < deadline)); do
    case "$svc" in
      api) curl -fsS --max-time 3 http://127.0.0.1:3000/ready >/dev/null 2>&1 && return 0 ;;
      gateway) curl -fsS --max-time 3 http://127.0.0.1:3001/health >/dev/null 2>&1 && return 0 ;;
      worker)
        # No port. Running for 15 seconds without systemd having to restart it
        # is the signal; the scheduler logs and the event log say the rest.
        local before
        before="$(systemctl show -p NRestarts --value dhun@worker)"
        sleep 15
        systemctl is-active --quiet "dhun@worker" &&
          [[ "$(systemctl show -p NRestarts --value dhun@worker)" == "$before" ]] && return 0
        return 1
        ;;
    esac
    sleep 3
  done
  return 1
}

switch_to() {
  local image="$1"
  printf 'IMAGE=%s\n' "$image" >"$ETC/release.env.next"
  mv "$ETC/release.env.next" "$ETC/release.env"
  local svc
  for svc in $(order); do
    log "restarting $svc on $image"
    systemctl reset-failed "dhun@$svc" >/dev/null 2>&1 || true
    systemctl restart "dhun@$svc"
    if ! healthy "$svc"; then
      log "$svc did not become healthy"
      return 1
    fi
    log "$svc healthy"
  done
}

cmd="${1:-}"
shift || true

case "$cmd" in
  env)
    umask 077
    cat >"$ETC/app.env.next"
    if ! grep -q '^DATABASE_URL=' "$ETC/app.env.next"; then
      rm -f "$ETC/app.env.next"
      die "app env has no DATABASE_URL; refusing"
    fi
    mv "$ETC/app.env.next" "$ETC/app.env"
    log "app env updated ($(grep -c '=' "$ETC/app.env") keys)"
    ;;

  pull)
    image="${1:?image}"
    valid_image "$image"
    read -r user token
    registry="${image%%/*}"
    echo "$token" | docker login "$registry" -u "$user" --password-stdin >/dev/null
    trap 'docker logout "$registry" >/dev/null 2>&1 || true' EXIT
    docker pull --quiet "$image" >/dev/null
    log "pulled $image"
    ;;

  migrate)
    image="${1:?image}"
    valid_image "$image"
    if [[ "${DHUN_RUNS_MIGRATIONS:-false}" != "true" ]]; then
      log "this host does not run migrations; skipping"
      exit 0
    fi
    log "migrating with $image"
    docker run --rm --name dhun-migrate \
      --env-file "$ETC/app.env" \
      -v "$ETC/db-ca.crt:$ETC/db-ca.crt:ro" \
      --log-driver journald --log-opt tag=dhun-migrate \
      "$image" migrate
    log "migrations and grants applied"
    ;;

  release)
    image="${1:?image}"
    valid_image "$image"
    [[ -f "$ETC/app.env" ]] || die "no app env; run 'dhun-deploy env' first"
    previous=""
    [[ -f "$ETC/release.env" ]] && previous="$(sed -n 's/^IMAGE=//p' "$ETC/release.env")"
    [[ -n "$previous" ]] && printf 'IMAGE=%s\n' "$previous" >"$ETC/release.env.prev"

    if switch_to "$image"; then
      log "release complete: $image"
      exit 0
    fi

    if [[ -n "$previous" && "$previous" != "$image" ]]; then
      log "rolling back to $previous"
      switch_to "$previous" || die "ROLLBACK FAILED — host is down; intervene now"
      die "release of $image failed; rolled back to $previous"
    fi
    die "release of $image failed and there is no previous release to return to"
    ;;

  rollback)
    [[ -f "$ETC/release.env.prev" ]] || die "no previous release recorded"
    previous="$(sed -n 's/^IMAGE=//p' "$ETC/release.env.prev")"
    switch_to "$previous" || die "rollback to $previous failed"
    log "rolled back to $previous"
    ;;

  status)
    echo "env:      $DHUN_ENV"
    echo "services: $DHUN_SERVICES"
    echo "release:  $(sed -n 's/^IMAGE=//p' "$ETC/release.env" 2>/dev/null || echo none)"
    echo "previous: $(sed -n 's/^IMAGE=//p' "$ETC/release.env.prev" 2>/dev/null || echo none)"
    for svc in $(order); do
      printf '%-8s  %s\n' "$svc" "$(systemctl is-active "dhun@$svc" 2>/dev/null || true)"
    done
    ;;

  *)
    die "usage: dhun-deploy env | pull <image> | migrate <image> | release <image> | rollback | status"
    ;;
esac
