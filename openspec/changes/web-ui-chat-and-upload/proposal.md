## Why

The Knowledge Engine backend now supports document ingestion intake and vector pipelines. To allow end-users to interact with the knowledge base, we need a responsive, accessible, and high-performance Web UI in `apps/web` with two primary views accessible via a sidebar:
1. An LLM Chat interface with conversation selection and on-demand pagination for previous message history.
2. A Document Upload interface supporting direct PDF uploads and public URL ingestion.

A platform-agnostic API client package in `packages/api` will encapsulate all HTTP communication using Axios, enabling clean reuse across web and mobile/future clients.

## What Changes

- Create `packages/api`: A shared, platform-agnostic API client library using Axios with typed endpoints for document uploads, conversation management, and LLM chat.
- Add shared UI components in `packages/ui` via Shadcn CLI (message-scroller, message-bubble, dialog, sidebar, tabs, file dropzone, input, buttons).
- Build the Web application layout in `apps/web`:
  - Responsive Sidebar navigation to switch between Chat and Upload views.
  - Chat View: Conversation history list, active conversation view, message scroller, on-demand previous message loading (infinite scroll/pagination), prompt input, and streaming response bubbles.
  - Upload View: Tabbed/split view for Direct PDF File Upload (with drag-and-drop, format validation) and Public URL Ingestion (with SSRF-safe submission).
- Ensure strict adherence to WCAG 2.2 accessibility, Tailwind CSS design system tokens, and Vercel React best practices.
- Add comprehensive Playwright end-to-end test suites covering navigation, conversation loading, message sending, and file/URL uploads.

## Capabilities

### New Capabilities
- `web-ui/chat-interface`: Chat UI with conversation selection, on-demand historical message loading, and message streaming.
- `web-ui/document-upload`: Upload UI supporting direct PDF file upload and public resource URL submission.
- `api-client/core`: Platform-agnostic Axios API client package in `packages/api`.

### Modified Capabilities
<!-- None -->

## Impact

- **Frontend Application**: Introduces interactive views, state management, and routing in `apps/web`.
- **Shared Packages**: Adds `packages/api` to monorepo workspace and expands `packages/ui` with Shadcn components.
- **Testing**: Adds Playwright E2E test files in `apps/web/e2e/`.
