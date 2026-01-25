# UptimeFlare AWS - Terraform Outputs

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table"
  value       = aws_dynamodb_table.uptimeflare.name
}

output "dynamodb_table_arn" {
  description = "ARN of the DynamoDB table"
  value       = aws_dynamodb_table.uptimeflare.arn
}

output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.uptimeflare.api_endpoint
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.uptimeflare.id
}

output "custom_domain_endpoint" {
  description = "Custom domain endpoint (if configured)"
  value       = var.custom_domain != "" ? "https://${var.custom_domain}" : null
}

output "aggregator_function_name" {
  description = "Name of the aggregator Lambda function"
  value       = aws_lambda_function.aggregator.function_name
}

output "api_function_name" {
  description = "Name of the API Lambda function"
  value       = aws_lambda_function.api.function_name
}

output "checker_role_arn" {
  description = "ARN of the checker Lambda IAM role"
  value       = aws_iam_role.checker_lambda.arn
}

output "central_region" {
  description = "Central AWS region for DynamoDB and API"
  value       = var.central_region
}

output "checker_regions" {
  description = "List of regions where checker Lambdas are deployed"
  value       = var.checker_regions
}

# Status page URLs
output "status_api_url" {
  description = "URL for status API endpoint"
  value       = "${aws_apigatewayv2_api.uptimeflare.api_endpoint}/api/status"
}

output "data_api_url" {
  description = "URL for data API endpoint (compatible with original UptimeFlare)"
  value       = "${aws_apigatewayv2_api.uptimeflare.api_endpoint}/api/data"
}

output "badge_api_url" {
  description = "URL for badge API endpoint"
  value       = "${aws_apigatewayv2_api.uptimeflare.api_endpoint}/api/badge"
}
