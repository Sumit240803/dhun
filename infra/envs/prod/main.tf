# Production. NOT applied until the founder decides to start paying for it
# (build-plan M21 slice 1, step 9). `terraform plan` is safe at any time.
#
#   cd infra/envs/prod
#   terraform init  -backend-config=../../secrets/backend.hcl -backend-config="key=prod/terraform.tfstate"
#   terraform plan  -var-file=../../secrets/prod.tfvars -out=prod.tfplan
#
# Two hosts: the API and workers together, the gateway alone — it scales on
# concurrency, and restarting it drops every socket, so it deploys on its own.
# About $187/month single-node Postgres, $248 with the standby
# (infra/README.md § Cost).

terraform {
  required_version = ">= 1.10"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {}
}

provider "digitalocean" {
  token = var.do_token
}

module "stack" {
  source = "../../modules/stack"

  env          = "prod"
  node_env     = "production"
  vpc_ip_range = "10.50.0.0/20"
  api_host     = "api"
  gateway_host = "gateway"

  hosts = {
    app = {
      size            = "s-4vcpu-8gb" # $48
      services        = ["api", "worker"]
      runs_migrations = true
    }
    realtime = {
      size            = "s-2vcpu-4gb" # $24
      services        = ["gateway"]
      runs_migrations = false
    }
  }

  # db-s-2vcpu-4gb allows ~97 app connections. 30 + 10 + 8 = 48, plus LISTEN
  # and a migration = 50 — room for a second API host without resizing.
  pool = {
    api     = 30
    gateway = 10
    worker  = 8
  }

  pg_size = "db-s-2vcpu-4gb" # $61
  # Set to 2 before real money flows: a standby with automatic failover.
  pg_node_count = var.pg_node_count
  cache_size    = "db-s-1vcpu-2gb" # $30

  ssh_key_names     = var.ssh_key_names
  deploy_public_key = var.deploy_public_key
  alert_emails      = var.alert_emails
  slack_webhook_url = var.slack_webhook_url

  app_settings = {
    LOG_LEVEL    = "info"
    CORS_ORIGINS = ""
    OTP_PROVIDER = "msg91"
    # 'none' fails loudly on the first email send. Correct until a real sender
    # exists; email sign-up is unavailable in prod until then.
    EMAIL_PROVIDER = "none"
    IAP_PROVIDER   = "google_play"
    PUSH_PROVIDER  = "expo"
    R2_BUCKET      = "dhun-media"
    # PRIVATE. Never the media bucket, which is public (backend/src/workers/jobs/analytics.ts).
    ANALYTICS_BUCKET = "dhun-analytics"
    # Shared by every instance and kept across deploys (middleware/rateLimit.ts).
    RATE_LIMIT_STORE = "redis"
  }
  app_secrets = var.app_secrets
}

output "api_url" {
  value = module.stack.api_url
}

output "gateway_url" {
  value = module.stack.gateway_url
}

output "hosts" {
  value = module.stack.hosts
}

output "app_env" {
  value     = module.stack.app_env
  sensitive = true
}
