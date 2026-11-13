# API Client Core Specification

## Purpose

Provides a platform-agnostic, strongly typed API client package using Axios that standardizes HTTP communication for document intake, conversation management, and chat interactions across web and mobile clients.

## Requirements

### Requirement: Platform-Agnostic HTTP Client Configuration
The system SHALL export a configurable Axios client instance supporting custom base URLs, tenant headers (`x-tenant-id`), request timeouts, and interceptors without browser or Node runtime dependencies.

#### Scenario: Client initialization with tenant context
- **WHEN** the API client is instantiated with baseUrl and tenantId
- **THEN** all outgoing requests automatically append the configured headers and default options

### Requirement: Document and URL Ingestion API Methods
The system SHALL provide typed methods for uploading multipart document files and submitting public resource URLs for ingestion.

#### Scenario: Direct file upload invocation
- **WHEN** client invokes `uploadDocument(file, options)`
- **THEN** the client serializes multipart form data and returns typed `DocumentUploadResponse`

#### Scenario: URL ingestion invocation
- **WHEN** client invokes `importFromUrl(params)`
- **THEN** the client sends a JSON payload to `/imports` and returns typed `ImportJobResponse`

### Requirement: Conversation and Message Management API Methods
The system SHALL provide typed methods for fetching conversation lists, retrieving cursor/paginated historical messages, creating new conversations, and streaming or sending chat messages.

#### Scenario: Paginated message history retrieval
- **WHEN** client invokes `getMessages(conversationId, { cursor, limit })`
- **THEN** the client returns a paginated list of messages with the next cursor
