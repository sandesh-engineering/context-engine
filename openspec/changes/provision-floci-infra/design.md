## Context

Knowledge Engine requires local infrastructure provisioning for testing and simulating rolling deployments across ALB, EC2, RDS, SQS, and S3 using Docker-based local AWS emulators (Floci / LocalStack) without making real AWS calls.

## Goals / Non-Goals

**Goals:**
- Provide a clean, flat Terraform root under `terraform/` using `inputs.tf`, `outputs.tf`, and `main.tf`.
- Adhere strictly to HashiCorp Terraform Style Guide conventions (two spaces indentation, lowercase names, singular resource naming, explicit types and descriptions on variables/outputs).
- Configure the AWS provider for LocalStack / Floci emulation with custom endpoints and mock credentials.
- Provision Application Load Balancer (ALB), 2 EC2 instances (`web` and `backend`), PostgreSQL RDS instance, standard SQS queues with DLQs, and S3 bucket with optional versioning.

**Non-Goals:**
- No custom multi-tier VPC / public-private subnet segregation (use default VPC/subnets to prevent unnecessary complexity).
- No complex nested Terraform module hierarchies.
- No multi-AZ database replication or automated backup schedules.
- No real AWS API calls or credential requirements.

## Decisions

### 1. File Structure: Single Flat Root Configuration
- **Choice**: Structure the configuration directly in `terraform/` across three clean files: `inputs.tf`, `outputs.tf`, and `main.tf`.
- **Rationale**: Meets user requirements for minimal, non-complex Terraform while maintaining clean separation of inputs, outputs, and resources.

### 2. LocalStack / Floci AWS Provider Emulation
- **Choice**: Configure `provider "aws"` with `endpoints` pointing to `var.aws_endpoint_url` (default `http://localhost:4566`), `s3_use_path_style = true`, and `skip_*` validation flags.
- **Rationale**: Allows instant execution and testing in local Docker emulator environments without requiring valid AWS account IDs or IAM permissions.

### 3. Rolling Deployment ALB Simulation
- **Choice**: Create `aws_lb` (Application Load Balancer), `aws_lb_target_group`, `aws_lb_listener`, and `aws_lb_target_group_attachment` for the web and backend EC2 instances.
- **Rationale**: Provides the foundational routing constructs needed to simulate blue/green or rolling deployment traffic shifts locally.

### 4. SQS Redrive Policy & DLQ Isolation
- **Choice**: Link ingestion and embedding queues to their respective DLQs using `redrive_policy` JSON with `maxReceiveCount = 5`.
- **Rationale**: Matches application resilience patterns and error retry behaviors.

## Risks / Trade-offs

- **[Risk] Emulator Feature Differences**: LocalStack / Floci might not support full EC2 virtualization or complex RDS parameter groups.
  - *Mitigation*: Use standard, basic instance declarations (`t3.micro`, `db.t3.micro`) without cloud-only advanced extensions.
