# Local Infrastructure Provisioning Specification

## Purpose

Provides local AWS infrastructure provisioning using Terraform targeting Floci / LocalStack emulation for ALB, EC2, RDS PostgreSQL, SQS queues with DLQs, and S3 document storage.

## Requirements

### Requirement: Local AWS Provider Configuration
The Terraform configuration SHALL configure the AWS provider to point all resource endpoints to the local emulator endpoint (Floci/LocalStack at `http://localhost:4566`) with mock credentials and local service overrides.

#### Scenario: Local endpoint routing
- **WHEN** `terraform apply` is executed against the configuration
- **THEN** all API requests for ec2, rds, sqs, s3, and elb are directed to the configured local endpoint without external network egress.

### Requirement: Messaging Infrastructure Provisioning (SQS & DLQs)
The Terraform configuration SHALL provision dedicated standard SQS queues for document ingestion and embedding processing, each configured with a redrive policy routing unprocessable messages to a corresponding Dead Letter Queue (DLQ).

#### Scenario: Queue and DLQ creation
- **WHEN** Terraform provisions the messaging resources
- **THEN** `knowledge-engine-ingestion-queue`, `knowledge-engine-ingestion-dlq`, `knowledge-engine-embedding-queue`, and `knowledge-engine-embedding-dlq` are created with standard delivery configurations.

### Requirement: Document Storage Provisioning (S3)
The Terraform configuration SHALL provision an S3 bucket for uploaded document artifacts with configurable object versioning support.

#### Scenario: S3 bucket and versioning state
- **WHEN** `enable_s3_versioning` is set to true or false
- **THEN** the target document storage bucket is created and matches the requested versioning status.
