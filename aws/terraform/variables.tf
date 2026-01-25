# UptimeFlare AWS - Terraform Variables

variable "project_name" {
  description = "Base name for all resources"
  type        = string
  default     = "uptimeflare"
}

variable "central_region" {
  description = "Central AWS region for DynamoDB, Aggregator, and API"
  type        = string
  default     = "us-east-1"
}

variable "checker_regions" {
  description = "List of AWS regions to deploy checker Lambdas"
  type        = list(string)
  default     = ["us-east-1", "eu-west-1", "ap-southeast-1"]
}

variable "monitors_config" {
  description = "JSON string of monitor configurations"
  type        = string
  sensitive   = true
}

variable "notification_config" {
  description = "JSON string of notification configuration"
  type        = string
  default     = "{}"
  sensitive   = true
}

variable "maintenances_config" {
  description = "JSON string of maintenance windows"
  type        = string
  default     = "[]"
}

variable "page_config" {
  description = "JSON string of page configuration"
  type        = string
  default     = "{}"
}

variable "password_protection" {
  description = "Basic auth credentials (user:pass format)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "custom_domain" {
  description = "Custom domain for API Gateway (optional)"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for custom domain (required if custom_domain is set)"
  type        = string
  default     = ""
}

variable "check_interval_minutes" {
  description = "Interval between health checks (minutes)"
  type        = number
  default     = 1
}

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode: PAY_PER_REQUEST or PROVISIONED"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "lambda_memory_size" {
  description = "Memory size for Lambda functions (MB)"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Timeout for Lambda functions (seconds)"
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    Project   = "UptimeFlare"
    ManagedBy = "Terraform"
  }
}
