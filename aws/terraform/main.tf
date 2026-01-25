# UptimeFlare AWS - Main Terraform Configuration
# Multi-region Lambda monitoring with DynamoDB and API Gateway

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Uncomment and configure for remote state
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "uptimeflare/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

# Default provider for central region
provider "aws" {
  region = var.central_region

  default_tags {
    tags = var.tags
  }
}

# Generate providers for each checker region dynamically
# Note: You need to configure providers for each region you want to deploy to
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "us_east_2"
  region = "us-east-2"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "us_west_1"
  region = "us-west-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "us_west_2"
  region = "us-west-2"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "eu_west_1"
  region = "eu-west-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "eu_west_2"
  region = "eu-west-2"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "eu_central_1"
  region = "eu-central-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "ap_southeast_1"
  region = "ap-southeast-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "ap_southeast_2"
  region = "ap-southeast-2"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "ap_northeast_1"
  region = "ap-northeast-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "af_south_1"
  region = "af-south-1"

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "sa_east_1"
  region = "sa-east-1"

  default_tags {
    tags = var.tags
  }
}

# Data source for current account
data "aws_caller_identity" "current" {}

# ============================================================================
# DynamoDB Table (Central Region)
# ============================================================================

resource "aws_dynamodb_table" "uptimeflare" {
  name         = "${var.project_name}_table"
  billing_mode = var.dynamodb_billing_mode
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Enable TTL for automatic cleanup
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.project_name}-dynamodb"
  }
}

# ============================================================================
# IAM Roles and Policies
# ============================================================================

# IAM role for checker Lambda
resource "aws_iam_role" "checker_lambda" {
  name = "${var.project_name}_checker_role"

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

# IAM policy for checker Lambda
resource "aws_iam_role_policy" "checker_lambda" {
  name = "${var.project_name}_checker_policy"
  role = aws_iam_role.checker_lambda.id

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
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.uptimeflare.arn
      }
    ]
  })
}

# IAM role for aggregator Lambda
resource "aws_iam_role" "aggregator_lambda" {
  name = "${var.project_name}_aggregator_role"

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

# IAM policy for aggregator Lambda
resource "aws_iam_role_policy" "aggregator_lambda" {
  name = "${var.project_name}_aggregator_policy"
  role = aws_iam_role.aggregator_lambda.id

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
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.uptimeflare.arn
      }
    ]
  })
}

# IAM role for API Lambda
resource "aws_iam_role" "api_lambda" {
  name = "${var.project_name}_api_role"

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

# IAM policy for API Lambda
resource "aws_iam_role_policy" "api_lambda" {
  name = "${var.project_name}_api_policy"
  role = aws_iam_role.api_lambda.id

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
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.uptimeflare.arn
      }
    ]
  })
}

# ============================================================================
# Lambda Functions - Central Region (Aggregator + API)
# ============================================================================

# Aggregator Lambda
resource "aws_lambda_function" "aggregator" {
  function_name = "${var.project_name}_aggregator"
  role          = aws_iam_role.aggregator_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = var.lambda_memory_size

  filename         = "${path.module}/../lambdas/aggregator/function.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/aggregator/function.zip")

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.uptimeflare.name
      MONITORS_CONFIG     = var.monitors_config
      NOTIFICATION_CONFIG = var.notification_config
      TIMEZONE            = "UTC"
    }
  }

  tags = {
    Name = "${var.project_name}-aggregator"
  }
}

# Aggregator CloudWatch Log Group
resource "aws_cloudwatch_log_group" "aggregator" {
  name              = "/aws/lambda/${aws_lambda_function.aggregator.function_name}"
  retention_in_days = var.log_retention_days
}

# EventBridge rule for aggregator (runs every minute)
resource "aws_cloudwatch_event_rule" "aggregator" {
  name                = "${var.project_name}_aggregator_schedule"
  description         = "Trigger aggregator Lambda every minute"
  schedule_expression = "rate(${var.check_interval_minutes} minute)"
}

resource "aws_cloudwatch_event_target" "aggregator" {
  rule      = aws_cloudwatch_event_rule.aggregator.name
  target_id = "aggregator"
  arn       = aws_lambda_function.aggregator.arn
}

resource "aws_lambda_permission" "aggregator_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aggregator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.aggregator.arn
}

# API Lambda
resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}_api"
  role          = aws_iam_role.api_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = var.lambda_memory_size

  filename         = "${path.module}/../lambdas/api/function.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambdas/api/function.zip")

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.uptimeflare.name
      MONITORS_CONFIG     = var.monitors_config
      MAINTENANCES_CONFIG = var.maintenances_config
      PAGE_CONFIG         = var.page_config
      PASSWORD_PROTECTION = var.password_protection
    }
  }

  tags = {
    Name = "${var.project_name}-api"
  }
}

# API CloudWatch Log Group
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = var.log_retention_days
}

# ============================================================================
# API Gateway
# ============================================================================

resource "aws_apigatewayv2_api" "uptimeflare" {
  name          = "${var.project_name}_api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = {
    Name = "${var.project_name}-api-gateway"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.uptimeflare.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id             = aws_apigatewayv2_api.uptimeflare.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.api.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "api_routes" {
  for_each = toset([
    "GET /api/status",
    "GET /api/data",
    "GET /api/config",
    "GET /api/incidents",
    "GET /api/history/{monitorId}",
    "GET /api/history/{monitorId}/all",
    "GET /api/badge",
    "GET /status",
    "GET /data",
    "GET /config",
    "GET /incidents",
    "GET /badge",
  ])

  api_id    = aws_apigatewayv2_api.uptimeflare.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.uptimeflare.execution_arn}/*/*"
}

# Optional custom domain
resource "aws_apigatewayv2_domain_name" "custom" {
  count       = var.custom_domain != "" ? 1 : 0
  domain_name = var.custom_domain

  domain_name_configuration {
    certificate_arn = var.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "custom" {
  count       = var.custom_domain != "" ? 1 : 0
  api_id      = aws_apigatewayv2_api.uptimeflare.id
  domain_name = aws_apigatewayv2_domain_name.custom[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

# ============================================================================
# Regional Checker Lambdas
# ============================================================================

# Module for regional checker deployment
module "checker_us_east_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "us-east-1") ? 1 : 0

  providers = {
    aws = aws.us_east_1
  }

  project_name            = var.project_name
  region                  = "us-east-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_us_east_2" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "us-east-2") ? 1 : 0

  providers = {
    aws = aws.us_east_2
  }

  project_name            = var.project_name
  region                  = "us-east-2"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_eu_west_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "eu-west-1") ? 1 : 0

  providers = {
    aws = aws.eu_west_1
  }

  project_name            = var.project_name
  region                  = "eu-west-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_eu_central_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "eu-central-1") ? 1 : 0

  providers = {
    aws = aws.eu_central_1
  }

  project_name            = var.project_name
  region                  = "eu-central-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_ap_southeast_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "ap-southeast-1") ? 1 : 0

  providers = {
    aws = aws.ap_southeast_1
  }

  project_name            = var.project_name
  region                  = "ap-southeast-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_ap_southeast_2" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "ap-southeast-2") ? 1 : 0

  providers = {
    aws = aws.ap_southeast_2
  }

  project_name            = var.project_name
  region                  = "ap-southeast-2"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_af_south_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "af-south-1") ? 1 : 0

  providers = {
    aws = aws.af_south_1
  }

  project_name            = var.project_name
  region                  = "af-south-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}

module "checker_sa_east_1" {
  source = "./modules/regional-checker"
  count  = contains(var.checker_regions, "sa-east-1") ? 1 : 0

  providers = {
    aws = aws.sa_east_1
  }

  project_name            = var.project_name
  region                  = "sa-east-1"
  central_region          = var.central_region
  dynamodb_table_name     = aws_dynamodb_table.uptimeflare.name
  dynamodb_table_arn      = aws_dynamodb_table.uptimeflare.arn
  monitors_config         = var.monitors_config
  lambda_role_arn         = aws_iam_role.checker_lambda.arn
  lambda_memory_size      = var.lambda_memory_size
  lambda_timeout          = var.lambda_timeout
  check_interval_minutes  = var.check_interval_minutes
  log_retention_days      = var.log_retention_days
  lambda_zip_path         = "${path.module}/../lambdas/checker/function.zip"
}
