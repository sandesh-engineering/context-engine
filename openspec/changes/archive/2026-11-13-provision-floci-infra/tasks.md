## 1. Terraform Inputs & Provider Setup

- [x] 1.1 Create `terraform/inputs.tf` defining input variables (`aws_region`, `aws_endpoint_url`, `environment`, `project_name`, `enable_s3_versioning`, `db_name`, `db_username`, `db_password`, `instance_type`, `ami_id`) with types and descriptions.

## 2. Infrastructure Resources (main.tf)

- [x] 2.1 Create `terraform/main.tf` with Terraform version constraints and AWS provider configured for local emulation (Floci/LocalStack at `http://localhost:4566`).
- [x] 2.2 Add SQS queues (`ingestion`, `embedding`) and corresponding DLQs with redrive policies in `terraform/main.tf`.
- [x] 2.3 Add S3 document storage bucket with optional versioning in `terraform/main.tf`.
- [x] 2.4 Add PostgreSQL RDS database instance in `terraform/main.tf`.
- [x] 2.5 Add EC2 application instances (`web` and `backend`), security group, ALB, target group, listener, and target group attachments in `terraform/main.tf`.

## 3. Outputs & HCL Validation

- [x] 3.1 Create `terraform/outputs.tf` exporting ALB DNS name/ARN, EC2 instance IDs, RDS connection endpoint, SQS queue URLs/ARNs, and S3 bucket details.
- [x] 3.2 Validate Terraform configuration using `terraform fmt -check` and `terraform validate` (or syntax verification).
