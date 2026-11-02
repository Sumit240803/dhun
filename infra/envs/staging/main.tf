# Staging. One host runs all three processes; small managed Postgres and Valkey.
#
#   cd infra/envs/staging
#   terraform init  -backend-config=../../secrets/backend.hcl -backend-config="key=staging/terraform.tfstate"
#   terraform plan  -var-file=../../secrets/staging.tfvars -out=staging.tfplan
#   terraform apply staging.tfplan
#   ../../scripts/sync-env.sh staging
#
# About $54/month for the host, Postgres and Valkey, plus $24 for the two load
# balancers (infra/README.md § Cost).

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

  env          = "staging"
  node_env     = "staging"
  vpc_ip_range = "10.40.0.0/20"
  api_host     = "api-staging"
  gateway_host = "gateway-staging"

  hosts = {
    app = {
      size            = "s-2vcpu-4gb" # $24
      services        = ["api", "gateway", "worker"]
      runs_migrations = true
    }
  }

  # db-s-1vcpu-1gb allows 22 app connections. 8 + 4 + 4 = 16, plus the
  # worker's LISTEN connection and one migration = 18. Headroom for psql.
  pool = {
    api     = 8
    gateway = 4
    worker  = 4
  }

  pg_size    = "db-s-1vcpu-1gb" # $15
  cache_size = "db-s-1vcpu-1gb" # $15

  ssh_key_names     = var.ssh_key_names
  deploy_public_key = var.deploy_public_key
  alert_emails      = var.alert_emails
  slack_webhook_url = var.slack_webhook_url

  app_settings = {
    LOG_LEVEL    = "info"
    CORS_ORIGINS = ""
    # Dev providers, by design until DLT and Play billing exist (stack § node_env).
    OTP_PROVIDER   = "console"
    EMAIL_PROVIDER = "console"
    IAP_PROVIDER   = "stub"
    PUSH_PROVIDER  = "expo"
    R2_BUCKET      = "dhun-media-staging"
    # PRIVATE. Never the media bucket, which is public (backend/src/workers/jobs/analytics.ts).
    ANALYTICS_BUCKET = "dhun-analytics-staging"
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
