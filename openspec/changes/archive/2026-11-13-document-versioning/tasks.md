## 1. Database

- [x] 1.1 Migration `AddDocumentVersioning1794000000000`: `documents.current_version_id` (FK, `ON DELETE SET NULL`, backfilled), unique `(document_id, version_number)`.
- [x] 1.2 `DocumentEntity.currentVersionId` and the unique index on `DocumentVersionEntity`.

## 2. Backend

- [x] 2.1 `IngestionPersistenceService`: first version becomes current on creation; `persistNewVersion` locks the document and takes the next version number.
- [x] 2.2 `IngestionJobsRepository.completeJobAndPromoteVersion`: promote or supersede (older chunks are kept), follow auto-generated titles, and complete the job in one transaction.
- [x] 2.3 Duplicate detection only matches the current version or newer ones, and only within the target document for new versions.
- [x] 2.4 Embedding poller completes jobs through the promotion step, including documents deleted mid-embedding.
- [x] 2.5 Retrieval (vector and keyword) only matches chunks of current versions.
- [x] 2.6 `DocumentsRepository` and endpoints: `POST /documents/:id/versions`, `GET /documents/filename-matches`, `DELETE /documents/:id`.
- [x] 2.7 Jobs list returns `documentId`, `versionId`, `versionNumber`, `isCurrent`.

## 3. Client and Web

- [x] 3.1 `@repo/api`: `uploadDocumentVersion`, `findFilenameMatches`, `deleteDocument`, and the new response fields.
- [x] 3.2 Upload form asks "new version or separate document?" when the file name matches.
- [x] 3.3 Jobs table: version and "Replaced" badges, "Upload new version" and "Delete" (with confirmation) on current-version rows.

## 4. Tests and Docs

- [x] 4.1 Unit tests: `document-versioning.spec.ts` (service) and embedding poller promotion.
- [x] 4.2 README: Technical Decision 16, Breaking Points and Non-Goals updated.
- [ ] 4.3 Run the migration and an end-to-end upload → new version → delete pass against a real Postgres with pgvector.
