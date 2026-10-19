variable "project" {
  description = "Name used in every resource and naming and tag"
  type        = string
  default     = "tutorials"
}

variable "region" {
  description = "AWS region for everything"
  type        = string
  default     = "us-east-1"
}

variable "my_ip" {
  description = "Your public IP with /32, the only address allowed to SSH in"
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip, 0)) && endswith(var.my_ip, "/32")
    error_message = "my_ip must look like 103.12.34.56/32"
  }
}