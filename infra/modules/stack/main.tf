# One environment, end to end. envs/staging and envs/prod each call this with
# their own sizes and names and nothing else, so the two cannot drift apart in
# shape — only in scale.

terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
    random       = { source = "hashicorp/random" }
  }
}

# ── Inputs ───────────────────────────────────────────────────────────────────

variable "env" {
  description = "staging | prod"
  type        = string
  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env is staging or prod."
  }
}

variable "node_env" {
  description = <<-EOT
    NODE_ENV for every process. Prod is "production", which refuses the console
    OTP, the stub purchase verifier and the console email sender. Staging is
    "staging" so it can run on those until DLT and Play billing exist — which
    also means ANYONE can sign in to staging, so it must never hold real users.
  EOT
  type        = string
}

variable "region" {
  type    = string
  default = "blr1"
}

variable "vpc_ip_range" {
  type = string
}

variable "domain" {
  type    = string
  default = "dhun.live"
}

variable "api_host" {
  type = string
}

variable "gateway_host" {
  type = string
}

variable "hosts" {
  type = map(object({
    size            = string
    services        = list(string)
    runs_migrations = bool
  }))
}

variable "pool" {
  type = map(number)
}

variable "pg_size" {
  type = string
}

variable "pg_node_count" {
  type    = number
  default = 1
}

variable "cache_size" {
  type = string
}

variable "ssh_key_names" {
  description = "Names of SSH keys already added to the DigitalOcean account (Settings → Security). Root access for people."
  type        = list(string)
}

variable "deploy_public_key" {
  type = string
}

variable "alert_emails" {
  type = list(string)
}

variable "slack_webhook_url" {
  type      = string
  default   = ""
  sensitive = true
}

variable "app_settings" {
  description = "Non-secret app configuration for this environment (providers, limits, URLs)."
  type        = map(string)
  default     = {}
}

variable "app_secrets" {
  description = "Provider credentials: LiveKit, R2, MSG91, Razorpay, Google Play, Expo push, alert transports. From the git-ignored secrets file."
  type        = map(string)
  default     = {}
  sensitive   = true

  validation {
    # docker --env-file has no multi-line values. A service-account JSON must
    # be supplied minified onto one line.
    condition     = alltrue([for v in values(var.app_secrets) : !strcontains(v, "\n")])
    error_message = "app_secrets values must be single-line (minify any JSON)."
  }
}

locals {
  app_tag = "dhun-${var.env}"
}

# ── Modules ──────────────────────────────────────────────────────────────────

module "network" {
  source   = "../network"
  env      = var.env
  region   = var.region
  ip_range = var.vpc_ip_range
}

module "data" {
  source        = "../data"
  env           = var.env
  region        = var.region
  vpc_id        = module.network.vpc_id
  app_tag       = local.app_tag
  pg_size       = var.pg_size
  pg_node_count = var.pg_node_count
  cache_size    = var.cache_size
}

data "digitalocean_ssh_key" "people" {
  for_each = toset(var.ssh_key_names)
  name     = each.value
}

module "compute" {
  source            = "../compute"
  env               = var.env
  region            = var.region
  vpc_id            = module.network.vpc_id
  app_tag           = local.app_tag
  hosts             = var.hosts
  pool              = var.pool
  ssh_key_ids       = [for k in data.digitalocean_ssh_key.people : k.id]
  deploy_public_key = var.deploy_public_key
  ca_certificate    = module.data.ca_certificate
}

module "edge" {
  source       = "../edge"
  env          = var.env
  region       = var.region
  vpc_id       = module.network.vpc_id
  app_tag      = local.app_tag
  domain       = var.domain
  api_host     = var.api_host
  gateway_host = var.gateway_host
}

module "monitoring" {
  source            = "../monitoring"
  env               = var.env
  app_tag           = local.app_tag
  api_fqdn          = module.edge.api_fqdn
  gateway_fqdn      = module.edge.gateway_fqdn
  alert_emails      = var.alert_emails
  slack_webhook_url = var.slack_webhook_url
}

# Every resource of the environment in one DigitalOcean project, so the console
# and the bill both read by environment.
resource "digitalocean_project" "this" {
  name        = "dhun-${var.env}"
  description = "Dhun ${var.env}"
  purpose     = "Service or API"
  environment = var.env == "prod" ? "Production" : "Staging"
  resources   = concat(module.compute.urns, module.data.urns, module.edge.urns)
}

# ── The app's environment ────────────────────────────────────────────────────

# Generated, never typed. Signs every access token and admin session; a
# rotation (terraform apply -replace) signs everyone out, which is the point.
resource "random_password" "jwt" {
  length  = 64
  special = false
}

locals {
  computed_env = {
    NODE_ENV     = var.node_env
    PORT         = "3000"
    GATEWAY_PORT = "3001"
    # One hop: the load balancer. req.ip is then the client, which every
    # IP-based rate limit depends on.
    TRUST_PROXY            = "1"
    DATABASE_URL           = module.data.database_url
    MIGRATION_DATABASE_URL = module.data.migration_database_url
    APP_DB_ROLE            = module.data.app_db_role
    REDIS_URL              = module.data.redis_url
    JWT_SECRET             = random_password.jwt.result
    # So an alert on a phone says which environment it came from, and links
    # to that environment's admin panel.
    ALERT_ENV_LABEL = var.env
    ALERT_LINK_BASE = module.edge.api_url
  }

  # Later wins: a computed value can never be overridden by a typo in a
  # settings or secrets file.
  app_env_map = merge(var.app_settings, var.app_secrets, local.computed_env)
  app_env     = join("\n", [for k in sort(keys(local.app_env_map)) : "${k}=${local.app_env_map[k]}"])
}

# ── Outputs ──────────────────────────────────────────────────────────────────

output "app_env" {
  description = "The full env file for every process. Synced to the GitHub environment secret APP_ENV by infra/scripts/sync-env.sh."
  value       = "${local.app_env}\n"
  sensitive   = true
}

output "hosts" {
  value = module.compute.hosts
}

output "api_url" {
  value = module.edge.api_url
}

output "gateway_url" {
  value = module.edge.gateway_url
}
