# Infrastructure: AWS Services

## Purpose

This document outlines the AWS cloud infrastructure services utilized by Knowledge Engine, defining the exact role and justification for each service.

---

## Service Mapping & Responsibilities

| Service | Responsibility | Rationale / Why Selected |
| :--- | :--- | :--- |
| **AWS S3** | Raw Document Object Storage | Provides durable, scalable object storage for raw uploaded file binaries (PDFs, Markdown) and large intermediate artifacts. |
| **AWS RDS PostgreSQL** | Relational State & Vector Storage | Serves as the single relational source of truth for application state, outbox messages, and vector embeddings (via `pgvector`). |
| **AWS SQS** | Work Queue Distribution | Provides reliable, simple, at-least-once asynchronous message queuing with native dead-letter queue (DLQ) support. |
| **AWS ECS / Fargate** | Container Compute Hosting | Hosts API server and ingestion worker container tasks without server management overhead. |

---

## Detailed Service Analysis

### 1. AWS S3 (Simple Storage Service)
- **Role**: Durable blob storage for raw files before parsing.
- **Access Pattern**: API server writes raw upload files using presigned URLs or SDK uploads. Workers read files during the `PARSING` stage.
- **Bucket Lifecycle**: Bucket policies enable versioning and server-side encryption (`SSE-S3`).

### 2. Amazon RDS PostgreSQL (with `pgvector`)
- **Role**: Primary ACID relational database and vector search engine.
- **Access Pattern**: Serves relational queries for users, documents, outbox messages, and cosine similarity vector queries over `document_chunks`.
- **Extension**: Enables `pgvector` for storing dense vector embeddings directly alongside document metadata.

### 3. AWS SQS (Simple Queue Service)
- **Role**: Asynchronous work queue distributing document processing jobs to worker tasks.
- **Access Pattern**: Outbox relay component pushes task messages to SQS. Ingestion workers poll SQS for incoming tasks.
- **Features**: SQS visibility timeouts handle worker failure retries. Dead-letter queue (DLQ) handles poison-pill messages.

### 4. AWS ECS / Fargate
- **Role**: Serverless container orchestration for API gateway and background ingestion worker instances.
- **Scalability**: Horizontal auto-scaling of worker containers based on SQS queue depth (`ApproximateNumberOfMessagesVisible`).

---

## Intentionally Excluded Services (V1 Non-Goals)

To prevent unnecessary architectural bloat, the following services are explicitly excluded:
- **AWS Kinesis / Kafka**: Stream retention and replay are unnecessary; SQS simple task distribution satisfies all ingestion queuing requirements.
- **AWS DynamoDB**: Multi-model storage complexity is avoided; AWS RDS PostgreSQL satisfies all relational and key-value state requirements.
- **AWS ElastiCache (Redis)**: Caching layer is deferred until database query bottlenecks are proven by load testing.
- **AWS EventBridge**: Complex event bus routing is unnecessary for point-to-point outbox queue dispatching.

---

## Related Documentation

- [[database]]
- [[messaging]]
- [[../architecture/overview]]
- [[../decisions/ADR-001-postgresql-pgvector]]
- [[../decisions/ADR-002-sqs-over-kinesis]]
