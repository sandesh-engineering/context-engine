## 1. Platform-Agnostic API Client Package (`packages/api`)

- [x] 1.1 Scaffold `packages/api` with TypeScript configuration, package.json, and Axios dependency, verifying workspace linking.
- [x] 1.2 Implement typed API client modules (`client.ts`, `documents.ts`, `conversations.ts`, `chat.ts`, `types.ts`) for document uploads, URL imports, conversation management, and paginated message retrieval.
- [x] 1.3 Export and build `packages/api` for workspace consumption across apps.

## 2. Shared Shadcn UI Components in `packages/ui`

- [x] 2.1 Generate and configure Shadcn UI components in `packages/ui` (Sidebar, Sheet, Tabs, Button, Input, Dropzone, Progress, Tooltip, Dialog, Badge, Card, MessageBubble, MessageScroller).
- [x] 2.2 Configure component index exports and verify styling compatibility with Tailwind CSS design tokens.

## 3. Web App Shell & Responsive Navigation (`apps/web`)

- [x] 3.1 Build responsive App Shell layout in `apps/web` with desktop collapsible Sidebar and mobile Sheet drawer for switching between Chat and Upload views.
- [x] 3.2 Ensure WCAG 2.2 accessibility compliance (keyboard navigation, visible focus rings, ARIA roles, color contrast).

## 4. Chat Interface with On-Demand Historical Pagination

- [x] 4.1 Implement `useConversation` hook managing active conversation state, cursor-based pagination, and reverse infinite scroll via `IntersectionObserver`.
- [x] 4.2 Build Chat View integrating `MessageScroller`, `MessageBubble`, prompt input textarea with multiline support, and streaming assistant token rendering.
- [x] 4.3 Add conversation sidebar selector with "New Chat" action and conversation thread activation.

## 5. Document Upload Interface (PDF & Public URL)

- [x] 5.1 Build Document Upload View with tabbed layout switching between Direct PDF File Upload and Public Resource URL Ingestion.
- [x] 5.2 Implement drag-and-drop PDF dropzone with real-time file validation (PDF only, size limits) and upload progress bar.
- [x] 5.3 Implement Public URL ingestion form with HTTPS validation and async Job ID confirmation feedback.
- [x] 5.4 Implement recent uploads/ingestion activity table with live status badges (`PENDING`, `AVAILABLE`, `FAILED`).

## 6. Playwright End-to-End Tests & Verification

- [x] 6.1 Author Playwright E2E test in `apps/web/e2e/navigation.spec.ts` testing sidebar view switching, active view states, and mobile drawer navigation.
- [x] 6.2 Author Playwright E2E test in `apps/web/e2e/chat.spec.ts` testing conversation selection, message sending, reverse scroll pagination, and streaming message display.
- [x] 6.3 Author Playwright E2E test in `apps/web/e2e/upload.spec.ts` testing PDF file selection, invalid file format rejection, URL submission, and upload progress feedback.
- [x] 6.4 Verify typecheck (`pnpm check-types` / `tsc --noEmit`) passes cleanly across `apps/web` and all workspace packages.
