# ADR-006: External Object Streaming Ingestion Architecture

## Status

Accepted

## Context

Knowledge Engine requires the capability to ingest documents from external sources, specifically external HTTP/HTTPS URLs and Amazon S3 presigned URLs (frequently provided with short expiration windows), and store them durably in our own AWS S3 object storage before initiating parsing, chunking, and embedding.

Ingesting arbitrary external objects introduces critical architectural challenges:
1. **Resource Saturation**: Spooling large files (hundreds of megabytes to tens of gigabytes) into application server RAM or local container storage causes Out-of-Memory (OOM) crashes and local disk exhaustion.
2. **Server-Side Request Forgery (SSRF)**: Allowing users to supply arbitrary URLs creates severe security risks, including attacks against internal services, loopback interfaces, private VPC endpoints, and cloud instance metadata services (`169.254.169.254`).
3. **Capability vs. Direct Access Ambiguity**: Presigned URLs represent short-lived HTTP capabilities without source bucket credentials, whereas direct cross-account S3 access allows server-side operations. Conflating these two patterns degrades security and efficiency.
4. **Data Integrity & Storage Leaks**: Worker failures during multipart uploads can leave orphaned upload parts in S3, accumulating unnecessary storage costs. Additionally, relying on HTTP headers (`Content-Length`, `Content-Type`) or S3 multipart ETags for verification can lead to corrupted or truncated objects.

## Decision

We will implement an **Asynchronous Streaming Ingestion Engine** governed by the following core architectural decisions:

1. **Asynchronous Ingestion**: The API server validates requests, creates domain records, enqueues work via the Transactional Outbox, and returns `202 Accepted` (`POST /imports`). Heavy data transfers never block HTTP client requests.
2. **Bounded HTTP-to-S3 Streaming**: When ingesting from external URLs or presigned URLs, workers stream data through bounded memory buffers (e.g., 8–16 MB) directly into AWS S3 multipart uploads (`CreateMultipartUpload` → `UploadPart` → `CompleteMultipartUpload`), avoiding local disk or memory spooling.
3. **Direct S3 Server-Side Copy**: When legitimate AWS IAM permissions exist to the source S3 bucket, workers use S3 `CopyObject` / multipart copy instead of routing bytes through worker compute.
4. **Presigned URL Capability Model**: Presigned URLs are treated strictly as short-lived HTTP capabilities. The system does not assume it can refresh expired third-party URLs. All presigned query parameters are redacted from logs and traces.
5. **Mandatory SSRF Defense-in-Depth**: Strict URL validation is enforced: HTTPS-only, no embedded credentials, pre-dial DNS resolution blocking RFC 1918, loopback, link-local/cloud metadata, and multicast addresses, DNS rebinding defense via socket IP pinning, and full SSRF re-validation on all HTTP redirects.
6. **Authoritative Byte Counting**: `Content-Length` is treated strictly as an optional preflight optimization. Hard file size limits are enforced by counting actual streamed bytes, aborting transfers exceeding configured thresholds.
7. **Untrusted External Content Classification**: Successfully downloaded files remain classified as `UNTRUSTED EXTERNAL DATA`. Security validation of file format and magic bytes is separated from AI/LLM instruction defense (e.g., prompt injection mitigation).
8. **Integrity Before Availability**: Objects transition to `AVAILABLE` state only after the stream completes and passes cryptographic SHA-256 validation. Downstream AI/LLM ingestion stages cannot consume incomplete or unverified objects.
9. **Idempotent Ingestion Execution**: Duplicate API requests are handled via `Idempotency-Key` lookups. SQS worker processing concurrency is managed via atomic SQL state transitions on `ingestion_jobs`.
10. **Defense-in-Depth Multipart Cleanup**: Incomplete multipart uploads are explicitly aborted on worker failure and backed by an AWS S3 Bucket Lifecycle rule (`AbortIncompleteMultipartUpload`) after a bounded window.

## Alternatives Considered

1. **Synchronous File Download in API Request Handler**:
   - *Pros*: Simpler request-response implementation.
   - *Cons*: HTTP gateway timeouts (e.g., 30s ALB/CloudFront limit), API process thread starvation, inability to handle files larger than a few megabytes.
2. **Download Entire File to Worker Local EBS / Disk Spooling**:
   - *Pros*: Allows offline file inspection before starting S3 upload.
   - *Cons*: Disk IOPS bottleneck, disk exhaustion under concurrent jobs, requires larger EBS volumes, slower time-to-first-byte to destination S3.
3. **Client-Side S3-to-S3 Transfer via Browser Direct Upload**:
   - *Pros*: Offloads transfer compute entirely from backend infrastructure.
   - *Cons*: Not viable when the user only possesses an external URL (e.g., pointing to an external provider or third-party S3 bucket) rather than a local file on their machine.
4. **Relying Solely on Hostname Allowlist for SSRF**:
   - *Pros*: Simple regex matching.
   - *Cons*: Vulnerable to open redirects, DNS rebinding, and dynamic DNS entries pointing to `127.0.0.1` or `169.254.169.254`.

## Rationale

- **Scalability & Cost Efficiency**: Streaming through bounded memory buffers ensures constant memory usage ($O(1)$ RAM) regardless of whether an object is 5 MB or 50 GB.
- **Enterprise Security Posture**: Eliminates SSRF vectors, protects against internal network reconnaissance, and ensures cloud metadata services cannot be reached.
- **Reliability & Waste Prevention**: Differentiating between source download failure (resumable only with Range/ETag) and destination upload failure (part retry) prevents restarting massive transfers unnecessarily, while lifecycle policies prevent orphaned multipart storage costs.

## Consequences

### Positive
- Predictable and bounded worker memory footprint under heavy concurrent load.
- Robust protection against SSRF, cloud credential theft, and denial-of-service via decompression/size bombs.
- Clear separation between storage-level validation and AI/LLM semantic safety.
- Durable tracking and failure recovery using existing outbox, SQS, and PostgreSQL primitives.

### Negative
- Requires maintaining custom HTTP client transport logic (DNS pre-resolution and IP pinning) to prevent DNS rebinding.
- Requires configuring and maintaining AWS S3 bucket lifecycle rules for multipart upload aborts.
- Introduces additional state machine states (`DOWNLOADING`, `UPLOADING`, `VERIFYING`) in the ingestion lifecycle.

## Revisit When

Reconsider aspects of this decision if:
1. Object ingestion demands real-time parallel multi-range downloads for multi-gigabyte objects across distributed workers.
2. AWS introduces native cross-account presigned URL direct S3-to-S3 copy capabilities that eliminate the need for application streaming compute.

## Related Documentation

- [[../architecture/ingestion]]
- [[../architecture/overview]]
- [[../architecture/reliability]]
- [[../infrastructure/aws]]
- [[../infrastructure/messaging]]
- [[../domain/ingestion-jobs]]
- [[ADR-002-sqs-over-kinesis]]
- [[ADR-003-transactional-outbox]]
