## Why

Provision reproducible local AWS cloud infrastructure for Knowledge Engine using Terraform targeting Floci / LocalStack emulator, enabling local rolling deployment simulations and infrastructure validation without incurring real AWS cloud costs.

## What Changes

- Add Terraform root configuration under `terraform/` configured with AWS provider pointing to local emulator endpoints (Floci/LocalStack).
- Provision Application Load Balancer (ALB) with target groups and HTTP listener for rolling deployment simulation.
- Provision EC2 instances for frontend web and backend API applications.
- Provision PostgreSQL RDS instance for vector and application data storage.
- Provision standard SQS queues (ingestion and embedding) alongside dedicated Dead Letter Queues (DLQs).
- Provision S3 bucket for document storage with optional versioning.
- Provide clean `inputs.tf`, `outputs.tf`, and `main.tf` following HashiCorp Terraform style conventions.

## Capabilities

### New Capabilities
- `infra/local-provisioning`: Terraform configuration provisioning ALB, EC2, RDS, SQS, and S3 resources on local AWS emulator.

### Modified Capabilities
<!-- None -->

## Impact

- **Infrastructure**: New `terraform/` directory containing `inputs.tf`, `outputs.tf`, and `main.tf`.
- **Local Dev**: Enables `terraform init`, `plan`, and `apply` against local Docker-based Floci/LocalStack emulator (`http://localhost:4566`).
- **Dependencies**: Requires Terraform CLI (>= 1.14) and AWS Provider (~> 6.0 / ~> 5.0).
