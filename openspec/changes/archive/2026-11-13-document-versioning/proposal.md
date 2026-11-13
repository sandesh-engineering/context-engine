> **Status: Approved and implemented (2026-11-13)** with option C, the filename hint, old version files kept indefinitely, and deletion included. One change from the text below: the filename check runs *before* the upload (`GET /documents/filename-matches`), not in the upload response. Checking afterwards would have left a stray duplicate document whenever the user answered "yes, it is a new version". See `tasks.md` and `specs/`.

## Why

Today an edited PDF becomes a second, unrelated document, so the old and new text both show up in answers and can contradict each other. Uploading the exact same bytes again is already handled (SHA-256 dedupe returns the existing document), but that is the only case covered.

The data model already supports versions (`documents` 1 → N `document_versions`, with `version_number`). What is missing is a rule for **which document a new upload belongs to**.

### The real problem: identity, not content

With a connector (Notion, Confluence), the source system gives every page a stable ID and a revision number. Versioning is then trivial: same page ID means a new version, whatever changed.

A direct upload only gives us the bytes and a filename, and neither one identifies a document:

| Signal | Why it cannot decide on its own |
| :--- | :--- |
| **Filename** | Two different documents can share a name (`manual.pdf`, `README.pdf`). The same document can be renamed (`policy-final-v2.pdf`). Matching on name would silently replace the wrong document, or miss the real one. |
| **Content similarity** | It fails in exactly the case that matters: if the user rewrote the whole document, the new file looks like a different document. It is also costly and gives a fuzzy score where we need a yes/no answer. |
| **SHA-256** | Only proves the bytes are identical. Any edit changes it. |

So for the scenario "the user rewrote the whole file and uploaded it again under the same name", **the system cannot know, and should not guess.** Only the user knows whether it is a new version of the same document.

## What Changes

**Recommended: the user says which document it replaces.**

1. **Normal upload never versions.** `POST /documents/upload` keeps creating a new document, as it does today. Same filename or not, nothing is replaced automatically.
2. **Explicit "Upload new version".** A new endpoint `POST /documents/:documentId/versions` and an "Upload new version" action on each row of the documents table. The user picks the document, so identity is declared, not inferred. How much of the content changed does not matter: a full rewrite is still a new version because the user said so.
3. **Filename hint.** Before uploading, the UI asks `GET /documents/filename-matches?filename=` whether a document's current version has the same file name. If so, it asks "Is this a new version of *X*?" and sends the file to the versions endpoint or to the normal upload. This is a suggestion only, never automatic.
4. **Only the current version answers questions.**
   - Add `documents.current_version_id`.
   - It moves to the new version **only when that version's ingestion job completes**. Until then the old version keeps answering. If the new version fails, the old one stays current.
   - Older versions keep their chunks (revised 2026-11-13; the first cut deleted them). Retrieval filters on the current version, so those chunks stop matching. The cost is a growing HNSW index and a larger "filter after the index returns fewer results" effect for documents with many versions. A cleanup job for old versions can handle that later.
   - The old `document_versions` row and its S3 object are **kept**, so citations in old conversations (which store `versionId`) still open the exact PDF page they quoted.
5. **Edge cases**
   - The same bytes as the current version (or a newer one still indexing): no-op, returns that version. The bytes of an *older* version count as a rollback and create a new version.
   - Two new versions uploaded at almost the same time: `UNIQUE (document_id, version_number)`, and the current version is the highest `version_number` whose job completed. A slower, older upload cannot overwrite a newer one.
6. **Deletion (same change, since it reuses the same plumbing).** `DELETE /documents/:documentId` removes the chunks straight away (so the document stops answering at once), then deletes the versions and the S3 objects. Old citations then show "source removed".

### Alternatives considered

| Option | Verdict |
| :--- | :--- |
| A. Automatic match on filename | Rejected. A false match silently hides a different document from every answer. |
| B. Automatic match on content similarity | Rejected. It fails on full rewrites, and it is costly and unpredictable. |
| **C. Explicit "new version" action (+ optional filename hint)** | **Recommended.** Correct by construction, small change, and the same model connectors will use later (their page ID simply takes the place of the user's choice). |
| D. Deletion only (user deletes the old file, uploads the new one) | Cheapest fallback. Loses version history, and old citations break. Acceptable if C is not approved. |

## Non-Goals

- Diffing versions or showing what changed.
- Answering against an older version ("what did v2 say?").
- Connector sync. It will reuse this model later, with the source system's ID as the identity.
- Restoring a deleted document.

## Impact

- **Database:** a migration adding `documents.current_version_id` (backfilled to each document's only version), `UNIQUE (document_id, version_number)`, and an index on `document_chunks.version_id` if one is missing.
- **API:** `POST /documents/:documentId/versions`, `DELETE /documents/:documentId`, and `GET /documents/filename-matches`. The jobs list gains `documentId`, `versionId`, `versionNumber` and `isCurrent`. `@repo/api` gets the matching client methods.
- **Worker:** the embedding poller's completion step also switches `current_version_id`, in the same transaction that completes the job.
- **Retrieval:** both searches only match chunks of a document's current version, so a new version's chunks stay hidden while it is still being indexed. Superseded chunks are kept and filtered out.
- **Web:** an "Upload new version" action, a "Delete" action, and the version number in the documents table.

## Decisions

1. Option **C** (explicit "new version" action).
2. Filename hint included in the first cut, as a check before the upload.
3. Old versions' S3 objects are kept indefinitely. A retention job can come later.
4. `DELETE /documents/:id` ships in this change.
