w## Context

The repository is a Turborepo monorepo with `apps/web` (Next.js 14+ App Router, Tailwind CSS, TypeScript) and `packages/ui`. The backend provides document ingestion intake and chat capabilities. This design defines the web application architecture, shared API client package `packages/api`, Shadcn component composition in `packages/ui`, and Playwright test coverage.

## Goals / Non-Goals

**Goals:**
- Create `packages/api`: Platform-agnostic Axios HTTP client library with typed methods for documents, URL imports, conversations, and chat messages.
- Expand `packages/ui`: Download and configure Shadcn UI components (Sidebar, MessageBubble, MessageScroller, Button, Input, Dropzone, Tabs, Progress, Tooltip, Dialog).
- Build Web App in `apps/web`:
  - Persistent responsive Sidebar with mobile Sheet drawer to switch between Chat and Upload views.
  - Chat View: Conversation sidebar selector, active chat session, on-demand upward paginated historical message loading, auto-scrolling message bubbles, and real-time streaming state.
  - Upload View: Dual tab interface supporting direct PDF file upload (v1) and public URL ingestion (v1) with live feedback and state indicators.
- Ensure strict WCAG 2.2 accessibility (keyboard navigation, `aria-live` streaming regions, proper focus traps) and mobile-to-desktop responsive layouts.
- Write complete Playwright test suites in `apps/web/e2e/` for all major flows.

**Non-Goals:**
- Building native mobile apps in `apps/app` (the API package is designed to be imported there later).
- Running Playwright tests automatically during planning (tests will be authored for manual invocation).
- Complex multi-modal or audio ingestion.

## Decisions

### 1. Platform-Agnostic API Client Package (`packages/api`)
- **Decision**: Create a dedicated workspace package `packages/api` using `axios`.
- **Structure**:
  ```text
  packages/api/
  ├── src/
  │   ├── client.ts          # Axios instance builder with interceptors & tenant headers
  │   ├── documents.ts       # uploadDocument(file), importFromUrl(url)
  │   ├── conversations.ts   # getConversations(), getMessages(id, cursor), createConversation()
  │   ├── chat.ts            # sendMessage(), streamMessage()
  │   ├── types.ts           # Shared TypeScript interfaces & DTOs
  │   └── index.ts
  ```
- **Rationale**: Isolates API transport logic from UI components, ensuring full reusability across `apps/web`, `apps/app`, and future tooling.

### 2. Component System in `packages/ui` via Shadcn
- **Decision**: Use Shadcn CLI to generate reusable UI primitives in `packages/ui` and re-export them.
- **Components**:
  - Layout & Navigation: `Sidebar`, `Sheet` (mobile navigation), `Tabs`, `Separator`.
  - Chat Components: `MessageBubble`, `MessageScroller` (with scroll-to-bottom and reverse-pagination observer), `PromptInput`.
  - Upload Components: `FileDropzone`, `Progress`, `Badge`, `Card`.
  - Feedback: `Toast` / `Sonner`, `Tooltip`, `Skeleton`.

### 3. Chat View & On-Demand Message Pagination (Reverse Infinite Scroll)
- **Decision**: Manage conversation and message state using a custom React hook (`useConversation`) with cursor-based pagination.
- **Scroll & Loading Mechanics**:
  - Initial view loads the latest batch (e.g. 20 messages) and auto-scrolls to the bottom.
  - An `IntersectionObserver` sentinel placed at the top of the message stream triggers fetching the previous batch (`beforeCursor`).
  - Scroll height difference is compensated so the user's viewport does not jump when older messages are prepended.
  - While streaming active response tokens, auto-scroll stays pinned to the bottom unless the user intentionally scrolls up.

### 4. Upload View (Direct PDF & Public URL)
- **Decision**: Create a unified tabbed container in `apps/web/app/upload/page.tsx` (or view switcher component):
  - **Tab 1 - Direct PDF Upload**: Drag-and-drop zone with instant PDF magic-byte/extension validation, file size check, and upload progress bar calling `api.documents.uploadDocument()`.
  - **Tab 2 - Public URL Ingestion**: URL input field validating HTTPS schema, initiating server-side ingestion via `api.documents.importFromUrl()`, and returning the assigned Job ID.
  - **Recent Ingestion Activity**: Live cards/table displaying recent intake jobs and statuses (`PENDING`, `AVAILABLE`, `FAILED`).

### 5. Accessibility (WCAG 2.2) & Responsiveness
- **Accessibility**:
  - Chat stream container marked with `role="log"` and `aria-live="polite"`.
  - All interactive icons have accessible `aria-label`s and visible `:focus-visible` rings.
  - Keyboard shortcuts: `Ctrl/Cmd + K` for new chat, `Enter` to send, `Shift + Enter` for multiline prompts.
- **Responsiveness**:
  - Desktop: Collapsible permanent sidebar navigation (conversation list + view switcher).
  - Mobile / Tablet: Floating hamburger menu triggering a slide-over Sheet drawer.

## Risks / Trade-offs

- **[Risk] Scroll jumping during historical message prepending** → **[Mitigation]** Capture `scrollHeight` and `scrollTop` before prepending older messages, restoring scroll offset smoothly in `useLayoutEffect`.
- **[Risk] Large PDF upload network stalls** → **[Mitigation]** Axios upload progress tracking (`onUploadProgress`) connected to UI progress indicator with abort controller support.
- **[Risk] API package version divergence across monorepo** → **[Mitigation]** Linked as workspace dependency (`"@repo/api": "workspace:*"`) ensuring instant hot-reloading and type synchronization.
