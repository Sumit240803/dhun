# The data tier: managed Postgres for the ledger and everything else, managed
# Valkey for the room bus, gateway fan-out and rate limits.
#
# Managed on purpose (build-plan M21): backups and point-in-time recovery for a
# database whose entries are money must not depend on one person remembering
# to run something. Both clusters sit on the private network and accept
# connections only from droplets carrying the environment's tag.
#
# NO connection pooler. The workers hold a LISTEN connection for the outbox
# and take session-level advisory locks for job locking, and both break under
# PgBouncer's transaction mode. Each process sizes its own pool instead
# (DB_POOL_MAX, set by the compute module) to stay under the node's limit.

terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
  }
}

variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "app_tag" {
  description = "Droplet tag allowed through the database firewalls."
  type        = string
}

variable "pg_size" {
  type = string
}

variable "pg_node_count" {
  description = "1 = primary only. 2 adds a standby with automatic failover (doubles the price)."
  type        = number
  default     = 1
}

variable "cache_size" {
  type = string
}

variable "maintenance_day" {
  type    = string
  default = "sunday"
}

variable "maintenance_hour" {
  description = <<-EOT
    UTC. 01:00 UTC is 06:30 IST: the quietest hour for a late-night party app,
    and clear of every scheduled job (reconciliation 03:00, spend mix 03:30,
    purges 04:00–04:45, commission close 05:00 IST). A failover mid-reconcile
    would page someone for nothing.
  EOT
  type        = string
  default     = "01:00:00"
}

# ── Postgres ─────────────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "pg" {
  name                 = "dhun-${var.env}-pg"
  engine               = "pg"
  version              = "16"
  size                 = var.pg_size
  region               = var.region
  node_count           = var.pg_node_count
  private_network_uuid = var.vpc_id
  tags                 = [var.app_tag]

  maintenance_window {
    day  = var.maintenance_day
    hour = var.maintenance_hour
  }

  lifecycle {
    # Deleting this cluster deletes the ledger. Terraform must refuse; a
    # deliberate teardown removes this line in its own reviewed commit.
    prevent_destroy = true
  }
}

resource "digitalocean_database_db" "app" {
  cluster_id = digitalocean_database_cluster.pg.id
  name       = "dhun"
}

# The app's role. Owns nothing; ops/roles.sql grants it DML and revokes
# UPDATE/DELETE on the ledger. Migrations run as the cluster owner instead.
resource "digitalocean_database_user" "app" {
  cluster_id = digitalocean_database_cluster.pg.id
  name       = "dhun_app"
}

resource "digitalocean_database_firewall" "pg" {
  cluster_id = digitalocean_database_cluster.pg.id

  rule {
    type  = "tag"
    value = var.app_tag
  }
}

# The cluster's CA. Public material, written to every droplet so the app can
# verify the server it connects to (sslmode=verify-full) rather than trusting
# whatever answers on the private network.
data "digitalocean_database_ca" "pg" {
  cluster_id = digitalocean_database_cluster.pg.id
}

# ── Valkey (Redis-compatible) ────────────────────────────────────────────────

resource "digitalocean_database_cluster" "cache" {
  name                 = "dhun-${var.env}-cache"
  engine               = "valkey"
  version              = "8"
  size                 = var.cache_size
  region               = var.region
  node_count           = 1
  private_network_uuid = var.vpc_id
  tags                 = [var.app_tag]

  maintenance_window {
    day  = var.maintenance_day
    hour = var.maintenance_hour
  }
}

resource "digitalocean_database_firewall" "cache" {
  cluster_id = digitalocean_database_cluster.cache.id

  rule {
    type  = "tag"
    value = var.app_tag
  }
}

# ── Outputs ──────────────────────────────────────────────────────────────────

locals {
  ca_path = "/etc/dhun/db-ca.crt"
  pg_tail = "${digitalocean_database_cluster.pg.private_host}:${digitalocean_database_cluster.pg.port}/${digitalocean_database_db.app.name}?sslmode=verify-full&sslrootcert=${local.ca_path}"
}

output "database_url" {
  description = "The app's connection: dhun_app, private network, verified TLS."
  sensitive   = true
  value       = "postgresql://${digitalocean_database_user.app.name}:${urlencode(digitalocean_database_user.app.password)}@${local.pg_tail}"
}

output "migration_database_url" {
  description = "The owner's connection, for migrations and ops/roles.sql only."
  sensitive   = true
  value       = "postgresql://${digitalocean_database_cluster.pg.user}:${urlencode(digitalocean_database_cluster.pg.password)}@${local.pg_tail}"
}

output "redis_url" {
  description = "rediss:// — Valkey on DigitalOcean is TLS-only."
  sensitive   = true
  value       = digitalocean_database_cluster.cache.private_uri
}

output "ca_certificate" {
  value = data.digitalocean_database_ca.pg.certificate
}

output "ca_path" {
  value = local.ca_path
}

output "app_db_role" {
  value = digitalocean_database_user.app.name
}

output "urns" {
  value = [digitalocean_database_cluster.pg.urn, digitalocean_database_cluster.cache.urn]
}
