## ADDED Requirements

### Requirement: Secret Scanning Gate
The CI/CD pipeline SHALL scan the full git history of the repository for committed secrets using gitleaks on every run that builds images, and SHALL NOT build, push or deploy any image when a secret is found. Findings that are confirmed false positives SHALL be suppressible only through a committed `.gitleaksignore` entry.

#### Scenario: Secret found
- **WHEN** a commit in the history contains a value matching a gitleaks rule (for example an AWS access key) that is not listed in `.gitleaksignore`
- **THEN** the secret-scan job fails, and the build and both deploy jobs do not run.

#### Scenario: No secrets
- **WHEN** gitleaks reports no findings
- **THEN** the secret-scan job succeeds and does not block the build.

#### Scenario: Rollback run
- **WHEN** the pipeline is triggered with `image_tag` (rollback of an already-published image)
- **THEN** the secret scan is skipped together with quality and build, because nothing new is built.

### Requirement: Static Application Security Testing Gate
The CI/CD pipeline SHALL scan the backend, frontend and shared package source code with Semgrep using the ERROR-severity rules of the `p/owasp-top-ten` ruleset on every run that builds images, and SHALL NOT build, push or deploy any image when Semgrep reports a finding. Accepted findings SHALL be suppressible only by a `nosemgrep` comment with a reason, or a path entry in a committed `.semgrepignore`.

#### Scenario: Vulnerable code pattern
- **WHEN** a change introduces code matching an OWASP Top 10 rule (for example a SQL query built by string concatenation from request input)
- **THEN** the SAST job fails, reports the file, line and rule, and the build and deploy jobs do not run.

#### Scenario: Clean code
- **WHEN** Semgrep reports no findings
- **THEN** the SAST job succeeds and does not block the build.

### Requirement: Database Migration Check
When the backend package is affected by a change, the CI/CD pipeline SHALL start an ephemeral PostgreSQL container with the pgvector extension, and run the backend's existing migrations against an empty database. The check SHALL NOT generate or write any migration. The API deploy SHALL run only when this check succeeds. The container and its data SHALL be discarded when the job ends.

#### Scenario: Backend changed and migrations run
- **WHEN** `backend_changed` is `true` and every migration runs successfully from an empty database
- **THEN** the migration check succeeds and the API deploy may run.

#### Scenario: A migration fails
- **WHEN** any migration throws an error while running against the empty database
- **THEN** the migration check fails and the API deploy does not run.

#### Scenario: Backend not changed
- **WHEN** `backend_changed` is `false`
- **THEN** the migration check does not run, and the frontend deploy is unaffected.

#### Scenario: Only a migration file changed
- **WHEN** the only changed file is in `apps/backend/src/database/migrations/`
- **THEN** `backend_changed` is `true` (the folder belongs to the backend package) and the migration check runs.

### Requirement: Production Migrations Before API Switch
The API deploy SHALL apply pending database migrations to the production database using the newly deployed backend image, in a one-off container, before the running backend and worker containers are replaced. If any migration fails, the deploy SHALL stop and the previously running containers SHALL keep serving.

#### Scenario: New migration deployed
- **WHEN** the API deploy runs with an image that contains a migration not yet applied in production
- **THEN** the migration is applied first, and only then are the backend and worker containers restarted on the new image.

#### Scenario: Migration fails in production
- **WHEN** a migration throws an error against the production database
- **THEN** the deploy fails, the backend and worker containers are not restarted, and the old version keeps serving.

#### Scenario: Rollback to an older image
- **WHEN** the API deploy runs with an older image (`image_tag` rollback) that has no pending migrations
- **THEN** the migration step completes without changes and the schema is left as it is.

### Requirement: Container Image Vulnerability Scanning Gate
The CI/CD pipeline SHALL scan every built image with Trivy before it is pushed to Docker Hub, and SHALL NOT push or deploy an image that contains HIGH or CRITICAL vulnerabilities for which a fix is available, or that contains a secret (for example a copied `.env` file or private key). Accepted findings SHALL be suppressible only through a committed `.trivyignore` entry with a comment explaining why.

#### Scenario: Secret baked into an image
- **WHEN** a built image contains a file with a value matching a Trivy secret rule that is not listed in `.trivyignore`
- **THEN** the build job for that image fails, and no tag of that build is pushed or deployed.

#### Scenario: Fixable high or critical vulnerability
- **WHEN** a built image contains a HIGH or CRITICAL vulnerability with a fixed version available that is not listed in `.trivyignore`
- **THEN** the build job for that image fails, no tag of that build is pushed to Docker Hub, and no deploy runs.

#### Scenario: Unfixed or lower-severity vulnerabilities only
- **WHEN** the image contains only LOW/MEDIUM vulnerabilities, or HIGH/CRITICAL ones with no fix available
- **THEN** the scan passes and the image is pushed with its commit-SHA and `latest` tags as before.

### Requirement: Non-Root Runtime Containers
The backend, worker and web images SHALL run their application process as the unprivileged `node` user, not root. Directories the application writes to at runtime (the backend's `./tmp` upload staging folder and the web app's `.next` folder) SHALL be owned by that user.

#### Scenario: Container starts
- **WHEN** any of the three images is started
- **THEN** the application process runs as user `node`.

#### Scenario: Runtime writes
- **WHEN** the backend stages an upload in `./tmp/documents`, or Next.js writes to `.next/cache`
- **THEN** the write succeeds without root privileges.

### Requirement: Automated Dependency Update Proposals
The repository SHALL configure Dependabot to check weekly for newer versions of GitHub Actions, Docker base images and npm packages, and to propose them as pull requests, with updates grouped to limit the number of open pull requests. Proposed updates SHALL NOT be built or deployed until a person merges them and runs the pipeline.

#### Scenario: Weekly update check
- **WHEN** a newer version of a GitHub Action, Docker base image or npm package is published
- **THEN** within a week Dependabot opens (or updates) a grouped pull request proposing it.

#### Scenario: Update not yet merged
- **WHEN** a Dependabot pull request is open and not merged
- **THEN** nothing is built or deployed for it.
