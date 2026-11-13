# Knowledge Engine

Upload your internal PDFs once, then ask questions in plain language and get answers with links back to the exact source.

## Table of Contents

- [TL;DR](#tldr)
- [Problem](#problem)
- [Solutions Explored](#solutions-explored)
- [Actual Solution](#actual-solution)
- [Breaking Points](#breaking-points)
- [Future Improvements](#future-improvements)
- [Technical Decisions](#technical-decisions)
  - [One database for data and vectors](#1-one-database-for-data-and-vectors)
  - [A work queue instead of an event stream](#2-a-work-queue-instead-of-an-event-stream)
  - [Transactional outbox](#3-transactional-outbox)
  - [Streaming uploads straight to storage](#4-streaming-uploads-straight-to-storage)
  - [Separate worker process](#5-separate-worker-process)
  - [Two-step pipeline with checkpoints](#6-two-step-pipeline-with-checkpoints)
  - [Local models behind an interface](#7-local-models-behind-an-interface)
  - [Structure-aware chunking](#8-structure-aware-chunking)
  - [Grounded answers with citations](#9-grounded-answers-with-citations)
  - [Optional hybrid search and reranking](#10-optional-hybrid-search-and-reranking)
  - [Streaming replies with SSE](#11-streaming-replies-with-sse)
  - [Monorepo with a shared API client](#12-monorepo-with-a-shared-api-client)
  - [Tracing and metrics](#13-tracing-and-metrics)
  - [Deployment](#14-deployment)

## TL;DR

- **Why:** Finding answers in internal docs is slow because the knowledge is spread across many files, and public AI tools raise privacy and context-size problems.
- **What:** A self-hosted RAG system. It streams PDFs into S3, splits them into chunks, embeds them with a local model, stores everything in PostgreSQL + pgvector, and answers questions with a local LLM. Answers include citations.
- **What worked:** The upload pipeline is reliable (outbox + SQS + checkpoints). Answers stay grounded and the system says so when it has no evidence. Replies stream token by token, and all models can be swapped.
- **What didn't (yet):** There is no login or rate limiting, only text-based PDFs are supported, and long chats can outgrow the model's context window.
- **Next:** S3 and URL imports, connectors (Notion, Confluence), and more file types plus multi-file upload.

## Problem

- Developers and support staff lose time digging through the codebase and many separate docs to answer one question.
- The same answer often lives in several places (PDF manuals, guides, specs), so people don't know which source to trust.
- Keyword search misses answers when the question uses different words than the document.
- New team members keep asking the same questions because there is no single place to look.
- When someone does find an answer, it is hard to check it against the original page.

## Solutions Explored

- **Just ask a public AI chatbot (ChatGPT, Gemini, and others)**
  - Internal documents would leave the company. This is a data privacy and compliance risk.
  - You have to paste the right documents into every chat, which is slow and easy to get wrong.
  - Context limits stop you from pasting a whole manual or many documents at once.
  - Answers come from the model's general knowledge, so it can invent facts that are not in your docs.
  - Answers have no reliable link back to the source page.
  - Per-token cost grows with every long document you paste.
- **Plain keyword search (wiki search, grep, file search)**
  - Cheap and simple, but it fails when wording differs.
  - It gives you a list of files, not an answer.
- **Hosted RAG products or a managed vector database**
  - Fast to start, but your data still goes to a third party.
  - It adds a second system to keep in sync with your main database.

## Actual Solution

- **Upload:** A user uploads a PDF in the web app. The API checks that the file really is a PDF (by its bytes, not its name), enforces a size limit, and streams it straight to S3 without holding the whole file in memory.
- **Queue:** In one database transaction, the API saves the document, its version, an ingestion job and an "outbox" event. A background poller moves the event to SQS.
- **Parse and chunk:** A separate worker downloads the PDF, extracts the text page by page, and splits it into chunks that follow headings and paragraphs.
- **Embed:** A second queue step creates a vector for every chunk with a local embedding model (Ollama). The vectors are stored in PostgreSQL with pgvector.
- **Track:** Every job has a status and stage (parsing, chunking, embedding, done or failed). The upload page shows them.
- **Ask:** In the chat, the question is turned into a vector and the closest chunks are found. Keyword search and a reranker can optionally be added to improve results.
- **Answer:** The best chunks go to a local LLM with strict instructions to answer only from them. The reply streams to the browser token by token.
- **Cite:** Each answer lists its sources. Clicking one opens the original PDF at the cited page.
- **Say "I don't know":** If no chunk is similar enough, the system says the docs don't cover the question instead of guessing.
- **Remember:** Conversations and messages are saved, so users can come back and keep asking follow-up questions.

## Breaking Points

- **No login or access control.** Anyone who can reach the API can upload files, read every conversation and open every stored document. It is only safe on a private network.
- **PDF only, one file at a time.** Scanned PDFs (images without text) fail because there is no OCR. Files are capped at 100 MB and 2,000 pages.
- **No rate limits.** One client can send unlimited questions (each one costs an LLM call) and unlimited 100 MB uploads.
- **Retries are blunt.** A failed job is retried by SQS until it reaches the dead-letter queue, even when the error can never succeed, such as a broken PDF. A job left by a crashed worker only resumes after twice the visibility timeout.
- **Vector search filters after the index.** HNSW returns the nearest chunks and the similarity threshold is applied afterwards, so a strict threshold can return fewer results than asked for. Past millions of chunks the database needs tuning or more memory.
- **Several workers can publish an event twice.** Outbox rows aren't locked. The job claim makes duplicates harmless, but they still cost a queue message.
- **Long chats grow without limit.** The model's chat context is stored and resent on every turn, so very long conversations eventually overflow the model's context window.
- **Local model quality depends on hardware.** Small local models answer worse than large hosted ones, and they need enough RAM or a GPU.
- **No versioning or deletion.** Re-uploading the same bytes returns the existing document, but an edited file becomes a new document, so old and new versions both appear in answers.
- **Single server.** Production runs with Docker Compose on one EC2 machine. If that machine goes down, everything is down, and each deploy causes a short outage.

## Future Improvements

- **S3 and URL import:** Ingest files from an S3 bucket, an S3 pre-signed link or a public URL, with SSRF protection (the design is in ADR-006).
- **Connectors:** Sync pages from Notion and Confluence, and keep them up to date when they change.
- **More file types:** Markdown, plain text, Word and HTML, plus OCR for scanned PDFs.
- **Multiple files at once:** Upload several files in one go and see the progress of each.

## Technical Decisions

### 1. One database for data and vectors

- **Problem:** We need normal tables (documents, jobs, chats) and vector search for chunks.
- **Explored:** PostgreSQL plus a separate vector database (Pinecone, Qdrant, Milvus), or MongoDB/OpenSearch with vector support.
- **Used:** PostgreSQL with the pgvector extension, for both data and vectors in one place. Writes are atomic, there is no sync job, and there is one backup.
- **Breaks when:** Vectors reach tens of millions, or vector search competes with normal queries for CPU and memory.

### 2. A work queue instead of an event stream

- **Problem:** Heavy work (parsing, embedding) must run in the background and be retried on failure.
- **Explored:** Kinesis or Kafka (event streams), RabbitMQ or Redis.
- **Used:** AWS SQS, with one queue for parsing, one for embedding, and a dead-letter queue for each. It provides per-message retries and needs nothing to manage.
- **Breaks when:** Several independent systems need to read or replay the same events. SQS deletes messages once they are handled.

### 3. Transactional outbox

- **Problem:** Saving to the database and sending to the queue are two separate writes. If one fails, a job is either lost or points to nothing.
- **Explored:** Sending to SQS right after the database write, two-phase commit, and change data capture (Debezium).
- **Used:** The event is written to an outbox table in the same transaction as the data. A poller sends pending events to SQS and marks them as sent.
- **Breaks when:** You run several workers. Rows aren't locked, so an event can occasionally be sent twice (the job claim makes this harmless). It also breaks when the outbox table grows very large and polling becomes slow. Only the worker process runs the pollers.

### 4. Streaming uploads straight to storage

- **Problem:** Large uploads can exhaust server memory or disk, and a file named `.pdf` may not be a PDF.
- **Explored:** Saving the upload to local disk first, or buffering it in memory.
- **Used:** The upload streams through a byte counter and a magic-byte check directly into an S3 multipart upload, and its SHA-256 is computed on the way. If the database step fails, the stored file is deleted.
- **Breaks when:** Uploads are very large or very many. Each one holds an API connection open for its whole length, and there is no quota per user.

### 5. Separate worker process

- **Problem:** Parsing untrusted PDFs is risky and CPU-heavy. It should not slow down or crash the API.
- **Explored:** Running the queue consumers inside the API process.
- **Used:** A separate `main-worker` entry point from the same codebase, built from the same image with its own Docker target. The entry point sets the role: only the worker runs the SQS consumers and outbox pollers, even if both processes share one env file. Locally, run `pnpm --filter backend dev:worker` next to `pnpm dev`.
- **Breaks when:** One worker is not enough. Workers process messages one by one, so throughput is limited until you add more workers or raise concurrency.

### 6. Two-step pipeline with checkpoints

- **Problem:** Parsing and embedding fail for different reasons (a bad file versus a busy model) and should be retried separately.
- **Explored:** One job that does everything in a single pass.
- **Used:** Two queue steps (parse and chunk, then embed). Each job has a stage checkpoint. A worker claims a job with one conditional `UPDATE` (optimistic, no locks). Failed jobs and jobs abandoned by a crashed worker can be claimed again and resume from their checkpoint. After the queue's maximum receive count, SQS moves the message to the dead-letter queue. Chunks are replaced in one transaction, so a repeated run doesn't create duplicates.
- **Breaks when:** A single stage runs longer than twice the visibility timeout. A second worker may then think the job was abandoned and process it at the same time.

### 7. Local models behind an interface

- **Problem:** Company docs must not leave the network, and developers should not need paid API keys.
- **Explored:** Hosted APIs (OpenAI, Anthropic, Gemini) for embeddings and chat.
- **Used:** Ollama for embeddings (`embeddinggemma`, 768 dimensions) and chat, behind `IEmbeddingProvider` and `ILlmProvider` interfaces. `EMBEDDING_PROVIDER` and `LLM_PROVIDER` switch to Gemini without code changes. Ollama calls have a timeout (`OLLAMA_TIMEOUT_MS`).
- **Breaks when:** You need frontier-level answer quality, or the server lacks RAM or a GPU. Changing the embedding provider or model means re-embedding every document.

### 8. Structure-aware chunking

- **Problem:** Cutting text at a fixed size splits sentences and loses the section a passage belongs to.
- **Explored:** Fixed-size chunks with overlap.
- **Used:** Chunks that follow pages, headings, paragraphs and lists. Each chunk keeps its heading path and page numbers, which power the citations.
- **Breaks when:** The PDF has no clear structure (slides, tables, multi-column layouts). Heading detection is a simple rule and can guess wrong.

### 9. Grounded answers with citations

- **Problem:** LLMs make things up, and users need to check answers.
- **Explored:** Letting the model answer freely and adding sources afterwards.
- **Used:** A similarity threshold, a fixed "not enough evidence" reply when nothing matches, a prompt that treats documents and questions as data rather than instructions, and citations that open the source PDF at the cited page.
- **Breaks when:** A chunk passes the threshold but doesn't actually answer the question. The model may still stretch the evidence. Prompt rules reduce prompt injection but cannot fully prevent it.

### 10. Optional hybrid search and reranking

- **Problem:** Vector search alone can miss exact terms such as error codes, names or IDs.
- **Explored:** Keeping vector search only.
- **Used:** Off by default behind flags: PostgreSQL full-text search merged with vector results (Reciprocal Rank Fusion), and a cross-encoder reranker (Hugging Face TEI or Ollama). If the reranker fails, results fall back to the original order.
- **Breaks when:** Both are turned on at high traffic. The reranker adds latency on every question and needs its own service.

### 11. Streaming replies with SSE

- **Problem:** Local models are slow, so waiting for the full answer feels broken.
- **Explored:** WebSockets, or a single response at the end.
- **Used:** Server-Sent Events over a POST request. Tokens stream as they are generated, and the user can stop a reply, which cancels the model call.
- **Breaks when:** A proxy buffers or times out long-lived responses.

### 12. Monorepo with a shared API client

- **Problem:** The frontend and backend drift apart, and builds get slow.
- **Explored:** Separate repositories.
- **Used:** A Turborepo + pnpm monorepo (`apps/backend` in NestJS, `apps/web` in Next.js, and the shared packages `@repo/api` and `@repo/ui`). Turborepo only rebuilds the apps a change affects.
- **Breaks when:** The shared client is not kept in sync by hand. Nothing checks the frontend and backend contracts against each other yet.

### 13. Tracing and metrics

- **Problem:** An upload passes through the API, the outbox, two queues and the worker, so a failure is hard to locate.
- **Explored:** Plain logs only.
- **Used:** OpenTelemetry traces carried across SQS messages, structured JSON logs, and Prometheus metrics on `/metrics`. Setting `METRICS_TOKEN` makes `/metrics` require a bearer token.
- **Breaks when:** `METRICS_TOKEN` is not set on a public server, or at high traffic, where full trace sampling gets costly.

### 14. Deployment

- **Problem:** We need a simple and cheap way to ship without manual steps on the server.
- **Explored:** ECS/Fargate and Kubernetes, which are too much to run for V1.
- **Used:** A manually triggered GitHub Actions pipeline that checks quality, builds only the affected Docker images and deploys them with Docker Compose over SSH. It restores the previous image tags if the deploy fails.
- **Breaks when:** You need zero downtime or more than one server. That needs rolling or blue-green deploys behind a load balancer.
