# Status Page Terraform Module
# Deploys Next.js status page to AWS using OpenNext
# Supports multiple custom domains for multi-tenant deployments

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "project_name" {
  type        = string
  description = "Base name for resources"
}

variable "site_id" {
  type        = string
  description = "Unique identifier for this status page site"
}

variable "custom_domain" {
  type        = string
  default     = ""
  description = "Custom domain for this status page (e.g., status.service1.com)"
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate ARN for custom domain (must be in us-east-1 for CloudFront)"
}

variable "api_endpoint" {
  type        = string
  description = "API Gateway endpoint URL for the monitoring API"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to the OpenNext server function zip"
}

variable "static_assets_path" {
  type        = string
  description = "Path to the OpenNext static assets directory"
}

variable "lambda_memory_size" {
  type    = number
  default = 1024
}

variable "lambda_timeout" {
  type    = number
  default = 30
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# S3 bucket for static assets
resource "aws_s3_bucket" "static_assets" {
  bucket = "${var.project_name}-status-${var.site_id}-assets"

  tags = {
    Name = "${var.project_name}-status-${var.site_id}-assets"
    Site = var.site_id
  }
}

resource "aws_s3_bucket_public_access_block" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Control for S3
resource "aws_cloudfront_origin_access_control" "static_assets" {
  name                              = "${var.project_name}-status-${var.site_id}-oac"
  description                       = "OAC for status page static assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# S3 bucket policy for CloudFront
resource "aws_s3_bucket_policy" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontAccess"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static_assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.status_page.arn
          }
        }
      }
    ]
  })
}

# IAM role for Lambda
resource "aws_iam_role" "lambda" {
  name = "${var.project_name}_status_${var.site_id}_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.project_name}_status_${var.site_id}_policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Lambda function for SSR
resource "aws_lambda_function" "server" {
  function_name = "${var.project_name}_status_${var.site_id}_server"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = var.lambda_memory_size
  architectures = ["arm64"]

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      AWS_API_ENDPOINT = var.api_endpoint
      DATA_PROVIDER    = "aws"
      SITE_ID          = var.site_id
    }
  }

  tags = {
    Name = "${var.project_name}-status-${var.site_id}-server"
    Site = var.site_id
  }
}

# Lambda function URL (alternative to API Gateway)
resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["*"]
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "server" {
  name              = "/aws/lambda/${aws_lambda_function.server.function_name}"
  retention_in_days = var.log_retention_days
}

# CloudFront distribution
resource "aws_cloudfront_distribution" "status_page" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  price_class         = "PriceClass_100" # US, Canada, Europe
  comment             = "Status page for ${var.site_id}"

  # Custom domain aliases
  aliases = var.custom_domain != "" ? [var.custom_domain] : []

  # Origin for static assets (S3)
  origin {
    domain_name              = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_id                = "s3-static"
    origin_access_control_id = aws_cloudfront_origin_access_control.static_assets.id
  }

  # Origin for SSR (Lambda function URL)
  origin {
    domain_name = replace(replace(aws_lambda_function_url.server.function_url, "https://", ""), "/", "")
    origin_id   = "lambda-ssr"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior - SSR
  default_cache_behavior {
    target_origin_id       = "lambda-ssr"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Host", "Accept-Language"]

      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 60
    max_ttl     = 300
  }

  # Static assets behavior
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 86400
    default_ttl = 604800
    max_ttl     = 31536000
  }

  # Public assets behavior
  ordered_cache_behavior {
    path_pattern           = "/public/*"
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 3600
    default_ttl = 86400
    max_ttl     = 604800
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == ""
    acm_certificate_arn            = var.certificate_arn != "" ? var.certificate_arn : null
    ssl_support_method             = var.certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.certificate_arn != "" ? "TLSv1.2_2021" : null
  }

  tags = {
    Name = "${var.project_name}-status-${var.site_id}"
    Site = var.site_id
  }
}

# Outputs
output "cloudfront_domain" {
  value       = aws_cloudfront_distribution.status_page.domain_name
  description = "CloudFront distribution domain"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.status_page.id
  description = "CloudFront distribution ID"
}

output "custom_domain" {
  value       = var.custom_domain
  description = "Custom domain (if configured)"
}

output "status_url" {
  value       = var.custom_domain != "" ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.status_page.domain_name}"
  description = "Status page URL"
}

output "s3_bucket" {
  value       = aws_s3_bucket.static_assets.bucket
  description = "S3 bucket for static assets"
}

output "lambda_function_name" {
  value       = aws_lambda_function.server.function_name
  description = "Lambda function name for SSR"
}
