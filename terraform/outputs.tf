output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "DNS endpoint address of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "backend_instance_id" {
  description = "EC2 instance ID for backend API server"
  value       = aws_instance.backend.id
}

output "database_endpoint" {
  description = "Connection endpoint address for the PostgreSQL RDS instance"
  value       = aws_db_instance.postgres.endpoint
}

output "database_name" {
  description = "Name of the provisioned PostgreSQL database"
  value       = aws_db_instance.postgres.db_name
}

output "embedding_dlq_url" {
  description = "SQS Queue URL for embedding worker Dead Letter Queue"
  value       = aws_sqs_queue.embedding_dlq.url
}

output "embedding_queue_url" {
  description = "SQS Queue URL for embedding processing queue"
  value       = aws_sqs_queue.embedding_queue.url
}

output "ingestion_dlq_url" {
  description = "SQS Queue URL for ingestion worker Dead Letter Queue"
  value       = aws_sqs_queue.ingestion_dlq.url
}

output "ingestion_queue_url" {
  description = "SQS Queue URL for document ingestion processing queue"
  value       = aws_sqs_queue.ingestion_queue.url
}

output "s3_bucket_arn" {
  description = "ARN of the S3 documents storage bucket"
  value       = aws_s3_bucket.documents.arn
}

output "s3_bucket_name" {
  description = "Name of the S3 documents storage bucket"
  value       = aws_s3_bucket.documents.id
}

output "web_instance_id" {
  description = "EC2 instance ID for frontend web application"
  value       = aws_instance.web.id
}
