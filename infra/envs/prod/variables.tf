# Everything here comes from infra/secrets/prod.tfvars (git-ignored).
# See infra/secrets/env.tfvars.example for the shape.

variable "do_token" {
  description = "DigitalOcean personal access token, read + write."
  type        = string
  sensitive   = true
}

variable "ssh_key_names" {
  description = "SSH keys already on the DigitalOcean account, for root access by people."
  type        = list(string)
}

variable "deploy_public_key" {
  description = "Public half of the pipeline's deploy key (ssh-ed25519 …)."
  type        = string
}

variable "alert_emails" {
  description = "Verified addresses for uptime and host alerts."
  type        = list(string)
}

variable "slack_webhook_url" {
  type      = string
  default   = ""
  sensitive = true
}

variable "app_secrets" {
  description = "Provider credentials for the app (LiveKit, R2, MSG91, Razorpay, alert transports …)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "pg_node_count" {
  description = "1 = primary only. Set 2 (a standby with automatic failover) before real money flows."
  type        = number
  default     = 1
}
