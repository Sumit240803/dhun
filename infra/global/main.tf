# Things shared by every environment: the DNS zone.
#
# Its own root so that staging and prod can each add records to dhun.live
# without either one owning (and being able to destroy) the zone itself.
# Applied once, before the first environment.
#
#   cd infra/global
#   terraform init -backend-config=../secrets/backend.hcl -backend-config="key=global/terraform.tfstate"
#   terraform apply -var-file=../secrets/global.tfvars
#
# After the first apply, point dhun.live's nameservers at the three in the
# `nameservers` output, at the registrar. Let's Encrypt certificates on a
# DigitalOcean load balancer can only be issued for a zone DigitalOcean serves.

terraform {
  required_version = ">= 1.10"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.60"
    }
  }

  backend "s3" {}
}

provider "digitalocean" {
  token = var.do_token
}

variable "do_token" {
  description = "DigitalOcean personal access token (read + write)."
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "The app domain."
  type        = string
  default     = "dhun.live"
}

resource "digitalocean_domain" "root" {
  name = var.domain
}

# Only Let's Encrypt may issue for this zone. A CAA record is cheap insurance
# against a mis-issued certificate for the API that takes money.
resource "digitalocean_record" "caa" {
  domain = digitalocean_domain.root.id
  type   = "CAA"
  name   = "@"
  value  = "letsencrypt.org."
  flags  = 0
  tag    = "issue"
  ttl    = 3600
}

output "domain" {
  value = digitalocean_domain.root.name
}

output "nameservers" {
  description = "Set these at the registrar for dhun.live."
  value       = ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"]
}
