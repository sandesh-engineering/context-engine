variable "ami_id" {
  description = "AMI ID for EC2 instances (mock AMI for local emulator)"
  type        = string
  default     = "ami-ubuntu2404-amd64"
}

variable "aws_endpoint_url" {
  description = "Target local AWS emulator endpoint URL (Floci/LocalStack)"
  type        = string
  default     = "http://localhost:4566"
}

variable "aws_region" {
  description = "AWS region for resource provisioning"
  type        = string
  default     = "us-east-1"
}

variable "backend_instance_type" {
  description = "EC2 instance type for the backend API server"
  type        = string
  default     = "t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage size for RDS PostgreSQL instance in gigabytes"
  type        = number
  default     = 20
}

variable "db_instance_class" {
  description = "Database instance class for RDS PostgreSQL"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Name of the default PostgreSQL database"
  type        = string
  default     = "knowledge_engine"
}

variable "db_password" {
  description = "Master password for RDS PostgreSQL administrator"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "db_username" {
  description = "Master username for RDS PostgreSQL administrator"
  type        = string
  default     = "postgres"
}

variable "enable_s3_versioning" {
  description = "Whether to enable object versioning on the S3 documents bucket"
  type        = bool
  default     = true
}

variable "environment" {
  description = "Deployment environment name (e.g., local, dev, staging, prod)"
  type        = string
  default     = "local"
}

variable "project_name" {
  description = "Root project name prefix used across resource tags and naming"
  type        = string
  default     = "knowledge-engine"
}

variable "sqs_max_receive_count" {
  description = "Maximum number of times a message can be received before routing to DLQ"
  type        = number
  default     = 5
}

variable "web_instance_type" {
  description = "EC2 instance type for the frontend web application"
  type        = string
  default     = "t3.micro"
}
