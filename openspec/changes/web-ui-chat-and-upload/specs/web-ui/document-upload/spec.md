## Purpose

Provides a responsive and accessible document upload interface in the web application supporting direct PDF file uploads and public URL ingestion into Knowledge Engine storage.

## ADDED Requirements

### Requirement: Direct PDF File Upload Intake
The system SHALL provide a drag-and-drop file upload zone allowing users to select or drop a single PDF document for direct streaming intake.

#### Scenario: User drops valid PDF file
- **WHEN** user drags and drops a file with `.pdf` extension into the upload dropzone
- **THEN** the interface validates file extension, displays file name and size, and displays an upload progress/submit button

#### Scenario: User submits non-PDF file
- **WHEN** user selects a file that is not a PDF
- **THEN** the system prevents submission, shows an accessible error message, and retains the dropzone state

### Requirement: Public Resource URL Ingestion
The system SHALL provide a URL submission input permitting users to provide a public HTTP/HTTPS URL for server-side ingestion into Knowledge Engine S3 storage.

#### Scenario: User submits valid public URL
- **WHEN** user enters a valid HTTPS URL and clicks "Import URL"
- **THEN** the system validates URL format, initiates the asynchronous import request, and displays the assigned import job tracking ID

#### Scenario: User enters invalid URL format
- **WHEN** user enters an invalid URL string or non-HTTPS protocol
- **THEN** the system displays inline validation feedback and disables the submit button

### Requirement: Upload State & Ingestion Progress Feedback
The system SHALL display real-time feedback during document upload and intake processing, including upload progress bars, pending status, success notifications, and clear error diagnostics.

#### Scenario: Successful upload feedback
- **WHEN** document upload completes with HTTP 202 Accepted
- **THEN** the system displays a success toast and renders the document metadata in the recent uploads list
