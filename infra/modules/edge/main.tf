# The edge: TLS, the two public entry points, their DNS names, and the
# firewall that makes them the ONLY way in.
#
# Two load balancers, not one, because a DigitalOcean load balancer routes by
# port, not by hostname, and the gateway must answer on 443: phones on Indian
# mobile networks and office Wi-Fi routinely cannot reach a WebSocket on 8443.
#
#   https://api[-staging].dhun.live      → hosts tagged …-api      :3000
#   wss://gateway[-staging].dhun.live/ws → hosts tagged …-gateway  :3001

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
  type = string
}

variable "domain" {
  type = string
}

variable "api_host" {
  description = "Record name under the domain, e.g. api-staging."
  type        = string
}

variable "gateway_host" {
  type = string
}

variable "lb_size_unit" {
  type    = number
  default = 1
}

variable "ssh_cidrs" {
  description = "Who may reach port 22. Key-only either way (cloud-init disables passwords); the deploy pipeline's runners have no fixed address, so this defaults open."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

locals {
  api_fqdn     = "${var.api_host}.${var.domain}"
  gateway_fqdn = "${var.gateway_host}.${var.domain}"
}

resource "digitalocean_certificate" "this" {
  name    = "dhun-${var.env}"
  type    = "lets_encrypt"
  domains = [local.api_fqdn, local.gateway_fqdn]

  lifecycle {
    create_before_destroy = true
  }
}

resource "digitalocean_loadbalancer" "api" {
  name      = "dhun-${var.env}-api"
  region    = var.region
  vpc_uuid  = var.vpc_id
  size_unit = var.lb_size_unit

  droplet_tag = "${var.app_tag}-api"

  redirect_http_to_https           = true
  disable_lets_encrypt_dns_records = true # the records below are ours
  http_idle_timeout_seconds        = 60

  forwarding_rule {
    entry_port       = 443
    entry_protocol   = "https"
    target_port      = 3000
    target_protocol  = "http"
    certificate_name = digitalocean_certificate.this.name
  }

  forwarding_rule {
    entry_port      = 80
    entry_protocol  = "http"
    target_port     = 3000
    target_protocol = "http"
  }

  # /ready, not /health: a container with a dead pool or an unreachable Valkey
  # is taken out of rotation, and a half-started one after a deploy never
  # receives traffic.
  healthcheck {
    protocol                 = "http"
    port                     = 3000
    path                     = "/ready"
    check_interval_seconds   = 10
    response_timeout_seconds = 5
    healthy_threshold        = 2
    unhealthy_threshold      = 3
  }
}

resource "digitalocean_loadbalancer" "gateway" {
  name      = "dhun-${var.env}-gateway"
  region    = var.region
  vpc_uuid  = var.vpc_id
  size_unit = var.lb_size_unit

  droplet_tag = "${var.app_tag}-gateway"

  redirect_http_to_https           = true
  disable_lets_encrypt_dns_records = true
  # The maximum. The gateway pings every 30 seconds, so a live socket is never
  # idle this long; a dead one is reaped by the heartbeat long before.
  http_idle_timeout_seconds = 600

  forwarding_rule {
    entry_port       = 443
    entry_protocol   = "https"
    target_port      = 3001
    target_protocol  = "http"
    certificate_name = digitalocean_certificate.this.name
  }

  healthcheck {
    protocol                 = "http"
    port                     = 3001
    path                     = "/health"
    check_interval_seconds   = 10
    response_timeout_seconds = 5
    healthy_threshold        = 2
    unhealthy_threshold      = 3
  }
}

resource "digitalocean_record" "api" {
  domain = var.domain
  type   = "A"
  name   = var.api_host
  value  = digitalocean_loadbalancer.api.ip
  ttl    = 300
}

resource "digitalocean_record" "gateway" {
  domain = var.domain
  type   = "A"
  name   = var.gateway_host
  value  = digitalocean_loadbalancer.gateway.ip
  ttl    = 300
}

# The hosts accept the app ports ONLY from their load balancers, so the TLS,
# the health check and the rate limiter's notion of a client IP can never be
# bypassed by calling a droplet's address directly.
resource "digitalocean_firewall" "hosts" {
  name = "dhun-${var.env}-hosts"
  tags = [var.app_tag]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_cidrs
  }

  inbound_rule {
    protocol                  = "tcp"
    port_range                = "3000"
    source_load_balancer_uids = [digitalocean_loadbalancer.api.id]
  }

  inbound_rule {
    protocol                  = "tcp"
    port_range                = "3001"
    source_load_balancer_uids = [digitalocean_loadbalancer.gateway.id]
  }

  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "api_url" {
  value = "https://${local.api_fqdn}"
}

output "gateway_url" {
  value = "wss://${local.gateway_fqdn}"
}

output "api_fqdn" {
  value = local.api_fqdn
}

output "gateway_fqdn" {
  value = local.gateway_fqdn
}

output "urns" {
  value = [digitalocean_loadbalancer.api.urn, digitalocean_loadbalancer.gateway.urn]
}
