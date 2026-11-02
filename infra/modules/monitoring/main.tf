# Watching from OUTSIDE (build-plan M21 slice 3).
#
# The app raises its own alerts (infra/alerts.ts) for what it can see: a failed
# reconciliation, an error burst, a stalled outbox. None of that fires when the
# process is dead, the host is gone or the certificate expired — the failures
# where the thing that would raise the alert is the thing that failed. These
# checks run from DigitalOcean's probes in three regions and notify directly.

terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
  }
}

variable "env" {
  type = string
}

variable "app_tag" {
  type = string
}

variable "api_fqdn" {
  type = string
}

variable "gateway_fqdn" {
  type = string
}

variable "alert_emails" {
  description = "Addresses DigitalOcean emails on an alert. Must be verified on the account."
  type        = list(string)
}

variable "slack_webhook_url" {
  description = "Optional Slack-compatible incoming webhook. Empty disables the Slack target."
  type        = string
  default     = ""
  sensitive   = true
}

variable "slack_channel" {
  type    = string
  default = "#dhun-alerts"
}

locals {
  checks = {
    api     = "https://${var.api_fqdn}/ready"
    gateway = "https://${var.gateway_fqdn}/health"
  }
  slack = var.slack_webhook_url == "" ? [] : [{ channel = var.slack_channel, url = var.slack_webhook_url }]
}

resource "digitalocean_uptime_check" "this" {
  for_each = local.checks

  name    = "dhun-${var.env}-${each.key}"
  target  = each.value
  type    = "https"
  regions = ["us_east", "eu_west", "se_asia"]
  enabled = true
}

resource "digitalocean_uptime_alert" "down" {
  for_each = digitalocean_uptime_check.this

  name     = "dhun-${var.env}-${each.key}-down"
  check_id = each.value.id
  type     = "down"
  period   = "2m"

  notifications {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.slack
      content {
        channel = slack.value.channel
        url     = slack.value.url
      }
    }
  }
}

resource "digitalocean_uptime_alert" "slow" {
  for_each = digitalocean_uptime_check.this

  name       = "dhun-${var.env}-${each.key}-slow"
  check_id   = each.value.id
  type       = "latency"
  threshold  = 2000
  comparison = "greater_than"
  period     = "5m"

  notifications {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.slack
      content {
        channel = slack.value.channel
        url     = slack.value.url
      }
    }
  }
}

# A certificate that lapses takes the app down for every user at once, and
# Let's Encrypt renewal on the load balancer is automatic until it is not.
resource "digitalocean_uptime_alert" "certificate" {
  name       = "dhun-${var.env}-certificate"
  check_id   = digitalocean_uptime_check.this["api"].id
  type       = "ssl_expiry"
  threshold  = 14
  comparison = "less_than"
  period     = "5m"

  notifications {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.slack
      content {
        channel = slack.value.channel
        url     = slack.value.url
      }
    }
  }
}

# Host resources. A disk filling with journal logs or a memory leak in the
# gateway shows here hours before it shows as an outage.
locals {
  host_alerts = {
    cpu    = { type = "v1/insights/droplet/cpu", value = 85, description = "CPU above 85% for 10 minutes" }
    memory = { type = "v1/insights/droplet/memory_utilization_percent", value = 90, description = "Memory above 90% for 10 minutes" }
    disk   = { type = "v1/insights/droplet/disk_utilization_percent", value = 85, description = "Disk above 85%" }
  }
}

resource "digitalocean_monitor_alert" "host" {
  for_each = local.host_alerts

  type        = each.value.type
  compare     = "GreaterThan"
  value       = each.value.value
  window      = "10m"
  enabled     = true
  tags        = [var.app_tag]
  description = "dhun-${var.env}: ${each.value.description}"

  alerts {
    email = var.alert_emails
    dynamic "slack" {
      for_each = local.slack
      content {
        channel = slack.value.channel
        url     = slack.value.url
      }
    }
  }
}
