# One private network per environment.
#
# Postgres, Valkey and the droplets talk over it; nothing in the data tier has
# a public address it answers on. Staging and prod get separate VPCs so a
# misconfigured staging host can never reach the production database, even by
# mistake.

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

variable "ip_range" {
  description = "Private CIDR. Must not overlap another VPC in the same account."
  type        = string
}

resource "digitalocean_vpc" "this" {
  name        = "dhun-${var.env}"
  region      = var.region
  ip_range    = var.ip_range
  description = "Dhun ${var.env}: droplets, Postgres and Valkey."
}

output "vpc_id" {
  value = digitalocean_vpc.this.id
}

output "vpc_urn" {
  value = digitalocean_vpc.this.urn
}

output "ip_range" {
  value = digitalocean_vpc.this.ip_range
}
