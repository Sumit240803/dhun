# The hosts. Each runs one or more of the three processes as systemd units
# around the one image (dhun@api, dhun@gateway, dhun@worker).
#
# Staging is one host running all three. Prod splits the gateway onto its own
# host, because it scales on concurrency rather than request rate and because
# restarting it drops every socket — it must deploy on its own schedule
# (CLAUDE.md § Architecture).

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
  description = "Tag on every host: the database firewalls and the host firewall key on it."
  type        = string
}

variable "hosts" {
  description = "Host name → size, the processes it runs, and whether deploys run migrations from it (exactly one should)."
  type = map(object({
    size            = string
    services        = list(string)
    runs_migrations = bool
  }))

  validation {
    condition     = length([for h in values(var.hosts) : h if h.runs_migrations]) == 1
    error_message = "Exactly one host must run migrations: two would race, none would leave the schema behind the code."
  }

  validation {
    condition     = alltrue(flatten([for h in values(var.hosts) : [for s in h.services : contains(["api", "gateway", "worker"], s)]]))
    error_message = "services may only contain api, gateway and worker."
  }
}

variable "pool" {
  description = "DB_POOL_MAX per process. The sum across hosts, plus one for the worker's LISTEN connection and one for a migration, must stay under the Postgres node's connection limit."
  type        = map(number)
}

variable "ssh_key_ids" {
  description = "DigitalOcean SSH key ids for root (people)."
  type        = list(string)
}

variable "deploy_public_key" {
  description = "Public half of the pipeline's deploy key. The private half is a GitHub environment secret."
  type        = string
}

variable "ca_certificate" {
  description = "The Postgres cluster's CA, PEM."
  type        = string
}

locals {
  publish = {
    api     = "-p 3000:3000"
    gateway = "-p 3001:3001"
    worker  = ""
  }
}

resource "digitalocean_droplet" "host" {
  for_each = var.hosts

  name       = "dhun-${var.env}-${each.key}"
  image      = "ubuntu-24-04-x64"
  size       = each.value.size
  region     = var.region
  vpc_uuid   = var.vpc_id
  ssh_keys   = var.ssh_key_ids
  monitoring = true
  ipv6       = true
  backups    = false # the hosts are cattle: everything on them comes from the image and the deploy

  # The load balancers find their targets by these tags: dhun-<env>-api, dhun-<env>-gateway.
  tags = concat([var.app_tag], [for s in each.value.services : "${var.app_tag}-${s}"])

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    env               = var.env
    services          = each.value.services
    runs_migrations   = each.value.runs_migrations
    publish           = local.publish
    pool              = var.pool
    deploy_public_key = trimspace(var.deploy_public_key)
    ca_b64            = base64encode(var.ca_certificate)
    unit_b64          = base64encode(file("${path.module}/dhun@.service"))
    deploy_b64        = base64encode(file("${path.module}/dhun-deploy.sh"))
  })

  lifecycle {
    # Bootstrap only. A changed template must not silently replace a running
    # host; replacing one is a deliberate `terraform apply -replace=…`.
    ignore_changes = [user_data, image, ssh_keys]
  }
}

output "hosts" {
  description = "Host name → public IPv4, the processes on it, and whether it runs migrations. The deploy pipeline reads this."
  value = {
    for name, h in var.hosts : name => {
      ipv4            = digitalocean_droplet.host[name].ipv4_address
      services        = h.services
      runs_migrations = h.runs_migrations
    }
  }
}

output "urns" {
  value = [for d in digitalocean_droplet.host : d.urn]
}

output "ids" {
  value = [for d in digitalocean_droplet.host : d.id]
}
