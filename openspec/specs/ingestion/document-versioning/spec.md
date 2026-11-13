# Document Versioning Specification

## Purpose

Lets users replace a document with a new version, or delete it, while only the current version of each document answers questions. Identity is declared by the user, never inferred from file names or content.

## Requirements

### Requirement: Explicit New Version Upload
The system SHALL let a user upload a file as the next version of an existing document through `POST /documents/:documentId/versions`, and SHALL never decide on its own, by file name or content, that an upload replaces another document.

#### Scenario: New version of an existing document
- **WHEN** a valid PDF is uploaded to `POST /documents/:documentId/versions` for an existing document
- **THEN** the system stores it as a new version numbered one higher than the document's highest version, queues its ingestion job, and returns HTTP 202 with `versionNumber`

#### Scenario: Unknown document
- **WHEN** the target document does not exist
- **THEN** the system returns HTTP 404 before storing any bytes

#### Scenario: Document deleted during the upload
- **WHEN** the document is deleted after the upload started but before its version is recorded
- **THEN** the system deletes the stored object and returns HTTP 404

#### Scenario: Same bytes as the current version
- **WHEN** the uploaded bytes match the current version, or a newer version still being indexed, of the same document
- **THEN** the system returns that version with `duplicate: true` and creates nothing

#### Scenario: Rollback to an older version's bytes
- **WHEN** the uploaded bytes match only a superseded version of the document
- **THEN** the system creates a new version from them

#### Scenario: Ordinary upload with a shared file name
- **WHEN** a file is uploaded through `POST /documents/upload` with the same name as an existing document
- **THEN** the system creates a separate document

### Requirement: Filename Match Hint
The system SHALL expose `GET /documents/filename-matches?filename=` returning the documents whose current version has that exact file name, so the client can ask the user before uploading.

#### Scenario: Matching document exists
- **WHEN** the client queries a file name used by a document's current version
- **THEN** the response lists that document's id, title and current version number

#### Scenario: Empty file name
- **WHEN** the file name is empty or whitespace
- **THEN** the system returns HTTP 400

### Requirement: Current Version Answers Questions
Each document SHALL have one current version. Vector and keyword retrieval SHALL only return chunks of current versions.

#### Scenario: First upload
- **WHEN** a new document is created
- **THEN** its first version is current immediately and its chunks become searchable as they are embedded

#### Scenario: New version finishes indexing
- **WHEN** every chunk of a newer version is embedded
- **THEN** in one transaction the version becomes current and the job is marked COMPLETED; older versions keep their chunks, which retrieval no longer returns

#### Scenario: New version still indexing or failed
- **WHEN** a newer version is not yet fully indexed, or its job failed
- **THEN** the previous current version keeps answering and the new version's chunks are not returned

#### Scenario: Older upload finishes last
- **WHEN** a version finishes indexing after a higher-numbered version is already current
- **THEN** the current version is unchanged and its job is marked COMPLETED

#### Scenario: Auto-generated title
- **WHEN** a new version becomes current and the document title equals the previous version's file name
- **THEN** the title changes to the new version's file name; a custom title is kept

#### Scenario: Citations of superseded versions
- **WHEN** a chat citation refers to a superseded version
- **THEN** its file still opens, because version rows and stored objects are kept

### Requirement: Document Deletion
The system SHALL delete a document through `DELETE /documents/:documentId`.

#### Scenario: Delete an existing document
- **WHEN** a client deletes an existing document
- **THEN** its versions, jobs and chunks are removed in one transaction (HTTP 204), it stops appearing in answers immediately, and its stored objects are then deleted on a best-effort basis

#### Scenario: Delete an unknown document
- **WHEN** the document does not exist
- **THEN** the system returns HTTP 404

#### Scenario: In-flight ingestion of a deleted document
- **WHEN** a queued ingestion or embedding message refers to a deleted document
- **THEN** the worker finds no job or chunks and settles the message without error
