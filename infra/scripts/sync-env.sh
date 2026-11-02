#!/usr/bin/env bash
# Copies what the deploy pipeline needs from Terraform into a GitHub environment.
#
#   infra/scripts/sync-env.sh staging
#   infra/scripts/sync-env.sh prod
#
# Run after every `terraform apply` that changes hosts, connection strings or
# app secrets. It writes, to the GitHub environment `staging` or `production`:
#
#   secret   APP_ENV          the full env file (Terraform output app_env)
#   secret   SSH_KNOWN_HOSTS  the hosts' SSH keys, pinned now, so the pipeline
#                             never trusts a key it sees for the first time
#   variable DEPLOY_HOSTS     {name: {ipv4, services, runs_migrations}}
#   variable API_URL          for the post-deploy smoke check
#
# Needs: terraform (or TERRAFORM="docker run … hashicorp/terraform"), gh signed
# in with repo admin rights, jq, ssh-keyscan. Nothing is printed: the values go
# straight from one tool's stdout into the other's stdin.

set -euo pipefail

env="${1:?usage: sync-env.sh staging|prod}"
case "$env" in
  staging) gh_env=staging ;;
  prod) gh_env=production ;;
  *) echo "unknown environment: $env" >&2; exit 64 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../envs/$env"
tf="${TERRAFORM:-terraform}"

$tf output -raw app_env | gh secret set APP_ENV --env "$gh_env"
echo "APP_ENV → $gh_env"

hosts="$($tf output -json hosts | jq -c .)"
gh variable set DEPLOY_HOSTS --env "$gh_env" --body "$hosts"
echo "DEPLOY_HOSTS → $gh_env ($(jq 'length' <<<"$hosts") hosts)"

gh variable set API_URL --env "$gh_env" --body "$($tf output -raw api_url)"
echo "API_URL → $gh_env"

# Pinned host keys. A fresh droplet may still be booting; retry briefly.
known=""
for ip in $(jq -r '.[].ipv4' <<<"$hosts"); do
  for _ in 1 2 3 4 5 6; do
    if line="$(ssh-keyscan -T 10 -t ed25519 "$ip" 2>/dev/null)" && [[ -n "$line" ]]; then
      known+="$line"$'\n'
      break
    fi
    sleep 10
  done
  [[ "$known" == *"$ip"* ]] || { echo "could not read the SSH host key of $ip" >&2; exit 1; }
done
printf '%s' "$known" | gh secret set SSH_KNOWN_HOSTS --env "$gh_env"
echo "SSH_KNOWN_HOSTS → $gh_env"
