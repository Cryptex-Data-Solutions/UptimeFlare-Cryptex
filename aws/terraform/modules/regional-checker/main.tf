# Regional Checker Lambda Module
# Deploys a checker Lambda to a specific AWS region

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "project_name" {
  type = string
}

variable "region" {
  type = string
}

variable "central_region" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "dynamodb_table_arn" {
  type = string
}

variable "monitors_config" {
  type      = string
  sensitive = true
}

variable "lambda_role_arn" {
  type = string
}

variable "lambda_memory_size" {
  type    = number
  default = 256
}

variable "lambda_timeout" {
  type    = number
  default = 30
}

variable "check_interval_minutes" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "lambda_zip_path" {
  type = string
}

# Checker Lambda function
resource "aws_lambda_function" "checker" {
  function_name = "${var.project_name}_checker_${replace(var.region, "-", "_")}"
  role          = var.lambda_role_arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = var.lambda_memory_size

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      CENTRAL_REGION  = var.central_region
      TABLE_NAME      = var.dynamodb_table_name
      MONITORS_CONFIG = var.monitors_config
      AWS_REGION_NAME = var.region
    }
  }

  tags = {
    Name   = "${var.project_name}-checker-${var.region}"
    Region = var.region
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "checker" {
  name              = "/aws/lambda/${aws_lambda_function.checker.function_name}"
  retention_in_days = var.log_retention_days
}

# EventBridge rule (runs every minute)
resource "aws_cloudwatch_event_rule" "checker" {
  name                = "${var.project_name}_checker_${replace(var.region, "-", "_")}_schedule"
  description         = "Trigger checker Lambda every ${var.check_interval_minutes} minute(s) in ${var.region}"
  schedule_expression = "rate(${var.check_interval_minutes} minute)"
}

resource "aws_cloudwatch_event_target" "checker" {
  rule      = aws_cloudwatch_event_rule.checker.name
  target_id = "checker"
  arn       = aws_lambda_function.checker.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.checker.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.checker.arn
}

# Outputs
output "lambda_function_name" {
  value = aws_lambda_function.checker.function_name
}

output "lambda_function_arn" {
  value = aws_lambda_function.checker.arn
}
