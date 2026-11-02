# infra/ — where Dhun runs

Build-plan M21. DigitalOcean, Bangalore (`blr1`), Terraform. Media and Terraform state on
Cloudflare R2. LiveKit Cloud for media until self-hosting pays for itself.

```
infra/
├─ global/            the dhun.live DNS zone, shared by both environments
├─ envs/staging/      one host: api + gateway + worker
├─ envs/prod/         two hosts: api + worker, gateway alone      (planned, not applied)
├─ modules/
│  ├─ stack/          one environment end to end; both envs call only this
│  ├─ network/        a VPC per environment
│  ├─ data/           managed Postgres 16 + managed Valkey, private network only
│  ├─ compute/        droplets, cloud-init, the systemd unit, dhun-deploy
│  ├─ edge/           TLS, the api and gateway load balancers, DNS, host firewall
│  └─ monitoring/     uptime checks, certificate expiry, host CPU/memory/disk alerts
├─ scripts/
│  ├─ sync-env.sh     Terraform outputs → the GitHub environment the pipeline reads
│  └─ deploy.sh       one image onto every host of one environment (the pipeline runs it)
└─ secrets/           git-ignored; only the .example files are committed
```

## Cost

Monthly, before tax. From DigitalOcean's published prices, 2026-11-02.

| | Staging | Prod |
|---|---|---|
| Hosts | 1 × s-2vcpu-4gb · $24 | s-4vcpu-8gb $48 + s-2vcpu-4gb $24 |
| Postgres | db-s-1vcpu-1gb · $15 | db-s-2vcpu-4gb · $61 (standby +$61) |
| Valkey | db-s-1vcpu-1gb · $15 | db-s-1vcpu-2gb · $30 |
| Load balancers (api, gateway) | 2 × $12 | 2 × $12 |
| **Total** | **≈ $78** | **≈ $187, or $248 with the standby** |

R2 (media, analytics archive, Terraform state) and LiveKit Cloud are billed separately.

## First apply — staging

Everything before step 4 is free.

1. **Accounts** (founder): a DigitalOcean account under the company email with billing; a
   personal access token with read + write. A private R2 bucket `dhun-terraform-state`
   and an R2 API token scoped to it. A LiveKit Cloud project. A private R2 bucket
   `dhun-analytics-staging` (never the public media bucket).
2. **Secrets** — copy the examples and fill them in. Neither file is ever committed.
   ```bash
   cp infra/secrets/backend.hcl.example infra/secrets/backend.hcl
   cp infra/secrets/env.tfvars.example  infra/secrets/staging.tfvars
   ssh-keygen -t ed25519 -C dhun-deploy -f ~/.ssh/dhun-deploy -N ""   # public half → staging.tfvars
   export AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…                   # the R2 state token
   ```
3. **DNS root**, once:
   ```bash
   cd infra/global
   terraform init -backend-config=../secrets/backend.hcl -backend-config="key=global/terraform.tfstate"
   terraform apply -var-file=../secrets/staging.tfvars
   ```
   Then set dhun.live's nameservers at the registrar to `ns1/ns2/ns3.digitalocean.com`.
   Certificates cannot be issued until that has propagated.
4. **Staging**:
   ```bash
   cd infra/envs/staging
   terraform init -backend-config=../../secrets/backend.hcl -backend-config="key=staging/terraform.tfstate"
   terraform plan -var-file=../../secrets/staging.tfvars -out=staging.tfplan
   terraform apply staging.tfplan
   ```
5. **GitHub**: create environments `staging` and `production` (Settings → Environments;
   give `production` a required reviewer). Then:
   ```bash
   infra/scripts/sync-env.sh staging                      # APP_ENV, DEPLOY_HOSTS, API_URL, SSH_KNOWN_HOSTS
   gh secret set DEPLOY_SSH_KEY --env staging < ~/.ssh/dhun-deploy
   gh secret set EXPO_TOKEN                               # repository secret, for OTA
   gh variable set DEPLOY_ENABLED --body true             # turns .github/workflows/deploy.yml on
   ```
6. **First deploy**: Actions → Deploy → Run workflow → staging. It builds the image, migrates,
   applies the grants and starts all three processes. Then create the first staff account
   on the host (below) and sign in at `https://api-staging.dhun.live/admin`.

**Exit, slice 1:** `curl https://api-staging.dhun.live/ready` answers `{"ok":true,…}` with
the deployed sha, and a preview build on a phone signs in.

Without Terraform installed locally, every command works through the official image:
`docker run --rm -v "$PWD/infra:/infra" -w /infra/envs/staging -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY hashicorp/terraform:1.12.2 plan …`
(set `TERRAFORM="docker run …"` for `sync-env.sh`).

## Day to day

| Task | How |
|---|---|
| Deploy staging | Merge to `main`. CI green → image → staging → OTA if `mobile/` changed |
| Deploy prod | `git tag v1.2.3 && git push --tags` — takes the image staging already ran, never builds |
| Roll back | Actions → Deploy → Run workflow, with the older sha. Or on a host: `sudo dhun-deploy rollback` |
| What is running | `ssh deploy@<host> sudo dhun-deploy status` |
| Logs | `journalctl -u dhun@api -f` on the host; errors are also at `/admin/events` |
| A staff account | On the API host as root: `docker run --rm --env-file /etc/dhun/app.env -v /etc/dhun/db-ca.crt:/etc/dhun/db-ca.crt:ro "$(sed -n 's/^IMAGE=//p' /etc/dhun/release.env)" staff create --email … --name … --role ops_manager` — the password is generated and shown once |
| Rotate a secret | Edit `secrets/<env>.tfvars`, `terraform apply`, `sync-env.sh <env>`, redeploy |
| A bad OTA update | `npx eas-cli update:republish --branch <channel>` to an earlier group, or `eas update:rollback` |

## What can break, and what notices

| Failure | Noticed by |
|---|---|
| A process crashes | systemd restarts it in 5 s; the crash is a row on `/admin/events` |
| API cannot reach Postgres or Valkey | `/ready` → 503, the load balancer stops sending traffic, the uptime check alerts in 2 min |
| A host or the whole region is down | DigitalOcean uptime checks, from three regions |
| Certificate within 14 days of expiry | The `ssl_expiry` uptime alert |
| Errors cluster | `error_burst_check` every 5 min (20 of one error, or 60 in total) → Telegram/webhook |
| A nightly job fails | The scheduler alerts per failed run; the 09:30 IST summary lists it again |
| The workers process is dead | No 09:30 IST summary. Its absence is the alert. |
| Disk, memory or CPU running hot | DigitalOcean monitor alerts on the environment tag |

## Rules that hold this together

1. **Migrations are expand-only.** The deploy migrates before any new code starts, and old
   code keeps serving against the new schema until its host is released. Add a column in
   one release; drop the old one in a later release.
2. **Production only receives an image staging ran.** A `v*` tag on a commit that never
   reached staging is refused by the pipeline.
3. **The deploy user can run one command as root, and is not in the docker group.**
   Everything goes through `dhun-deploy`, which refuses unpinned image references.
4. **No secret in droplet metadata.** cloud-init only bootstraps; the app env arrives with
   each deploy over SSH and lands at `/etc/dhun/app.env`, mode 600.
5. **The app connects directly, never through PgBouncer.** The workers' `LISTEN` and
   advisory locks break under transaction pooling. Pool sizes per process (`DB_POOL_MAX`)
   are set so the sum stays under the node's connection limit.
6. **The Postgres cluster has `prevent_destroy`.** Deleting it deletes the ledger.
