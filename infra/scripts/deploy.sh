#!/usr/bin/env bash
# Rolls one image onto every host of one environment.
#
#   DEPLOY_HOSTS=… APP_ENV=… REGISTRY_USER=… REGISTRY_TOKEN=… \
#     infra/scripts/deploy.sh ghcr.io/<owner>/dhun-backend:<sha>
#
# Run by .github/workflows/deploy.yml; runnable by hand from a laptop holding
# the deploy key. The SSH key must already be in the agent and the hosts in
# known_hosts (the pipeline loads both from the GitHub environment).
#
# Three phases, so nothing restarts until everything is ready to:
#
#   1. Prepare — every host gets the env file and pulls the image. A bad
#      token, a full disk or an unreachable host fails HERE, with the old
#      release still serving everywhere.
#   2. Migrate — once, from the host marked runs_migrations, before any new
#      code starts. Migrations must therefore be EXPAND-only (add, never drop
#      or rename in the same release), because the old code keeps serving
#      against the new schema until phase 3 reaches it.
#   3. Release — the migrating host first (API + worker), then the rest
#      (the gateway). Each host waits until healthy and rolls itself back if
#      not; a failed host stops the deploy, so the gateway is never moved onto
#      a release the API rejected.
#
# Optional: API_URL and EXPECT_VERSION — after release, /ready must report the
# new version, which proves the load balancer is serving the new build.

set -euo pipefail

image="${1:?usage: deploy.sh <image@sha>}"
: "${DEPLOY_HOSTS:?DEPLOY_HOSTS (JSON) is required}"
: "${APP_ENV:?APP_ENV is required}"
: "${REGISTRY_USER:?REGISTRY_USER is required}"
: "${REGISTRY_TOKEN:?REGISTRY_TOKEN is required}"

ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)

remote() {
  local ip="$1"
  shift
  # Expanding locally is the intent: the arguments are a subcommand and an
  # image reference, and dhun-deploy validates the reference on the host
  # against a pinned-tag pattern before using it.
  # shellcheck disable=SC2029
  ssh "${ssh_opts[@]}" "deploy@$ip" sudo /usr/local/bin/dhun-deploy "$@"
}

log() { printf '::group::%s\n' "$*"; }
end() { printf '::endgroup::\n'; }

# Migrating host first, then the rest, in a stable order.
mapfile -t hosts < <(jq -r '
  to_entries
  | sort_by([(if .value.runs_migrations then 0 else 1 end), .key])
  | .[] | "\(.key) \(.value.ipv4) \(.value.runs_migrations)"' <<<"$DEPLOY_HOSTS")

[[ ${#hosts[@]} -gt 0 ]] || { echo "DEPLOY_HOSTS lists no hosts" >&2; exit 1; }

log "1/3 prepare: env file and image on ${#hosts[@]} host(s)"
for entry in "${hosts[@]}"; do
  read -r name ip _ <<<"$entry"
  printf '%s\n' "$APP_ENV" | remote "$ip" env
  printf '%s %s\n' "$REGISTRY_USER" "$REGISTRY_TOKEN" | remote "$ip" pull "$image"
  echo "prepared $name ($ip)"
done
end

log "2/3 migrate"
for entry in "${hosts[@]}"; do
  read -r name ip migrates <<<"$entry"
  if [[ "$migrates" == "true" ]]; then
    remote "$ip" migrate "$image"
    echo "migrated from $name"
  fi
done
end

log "3/3 release"
for entry in "${hosts[@]}"; do
  read -r name ip _ <<<"$entry"
  echo "releasing $name ($ip)"
  remote "$ip" release "$image"
done
end

if [[ -n "${API_URL:-}" && -n "${EXPECT_VERSION:-}" ]]; then
  log "smoke: ${API_URL}/ready reports ${EXPECT_VERSION}"
  for _ in $(seq 1 30); do
    body="$(curl -fsS --max-time 5 "${API_URL}/ready" || true)"
    if [[ "$(jq -r '.version // empty' <<<"$body" 2>/dev/null)" == "$EXPECT_VERSION" ]]; then
      echo "serving $EXPECT_VERSION: $body"
      end
      exit 0
    fi
    sleep 5
  done
  echo "the load balancer is not serving $EXPECT_VERSION after 150s (last: ${body:-no answer})" >&2
  end
  exit 1
fi
