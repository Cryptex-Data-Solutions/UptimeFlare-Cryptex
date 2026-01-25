# Status Page Deployments
# Deploy multiple status page sites with custom domains
#
# Each site gets:
# - Its own CloudFront distribution
# - Its own Lambda function for SSR
# - Shared S3 bucket for static assets
# - Custom domain support

# Variable for status page configurations
variable "status_pages" {
  description = "Map of status page sites to deploy"
  type = map(object({
    custom_domain   = string
    certificate_arn = string
  }))
  default = {}
  # Example:
  # {
  #   service1 = {
  #     custom_domain   = "status.service1.com"
  #     certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/xxx"
  #   }
  #   service2 = {
  #     custom_domain   = "status.service2.com"
  #     certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/yyy"
  #   }
  #   aggregated = {
  #     custom_domain   = "status.aggregated-website.com"
  #     certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/zzz"
  #   }
  # }
}

variable "status_page_lambda_zip" {
  description = "Path to the OpenNext server Lambda zip file"
  type        = string
  default     = "../.open-next/server-function/index.zip"
}

variable "status_page_assets_path" {
  description = "Path to the OpenNext static assets directory"
  type        = string
  default     = "../.open-next/assets"
}

# Deploy status page for each configured site
module "status_page" {
  source   = "./modules/status-page"
  for_each = var.status_pages

  project_name     = var.project_name
  site_id          = each.key
  custom_domain    = each.value.custom_domain
  certificate_arn  = each.value.certificate_arn
  api_endpoint     = aws_apigatewayv2_api.uptimeflare.api_endpoint
  lambda_zip_path  = var.status_page_lambda_zip
  static_assets_path = var.status_page_assets_path
  lambda_memory_size = 1024
  lambda_timeout     = 30
  log_retention_days = var.log_retention_days
}

# Outputs for status pages
output "status_page_urls" {
  description = "URLs for all deployed status pages"
  value = {
    for site_id, page in module.status_page : site_id => page.status_url
  }
}

output "status_page_cloudfront_domains" {
  description = "CloudFront domains for all status pages"
  value = {
    for site_id, page in module.status_page : site_id => page.cloudfront_domain
  }
}
