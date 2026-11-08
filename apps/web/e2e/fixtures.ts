import { test as base, expect, type Route } from "@playwright/test";

/**
 * Playwright `test` with the Knowledge Engine API mocked.
 *
 * @remarks
 * Every request to `/api/v1/**` is answered here, so the e2e suite needs no backend, database or
 * LLM and never writes real data. Unknown endpoints get a 404 so a missing mock is obvious.
 */

export const MOCK_CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
export const MOCK_ANSWER = "Mocked answer from the knowledge base.";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const sse = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

async function handleApi(route: Route): Promise<void> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const path = pathname.replace(/^.*\/api\/v1/, "");
  const method = request.method();

  if (method === "GET" && path === "/conversations") {
    return json(route, {
      items: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    });
  }

  if (method === "POST" && /^\/conversations(\/[^/]+)?\/messages$/.test(path)) {
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        { token: MOCK_ANSWER, isComplete: false, conversationId: MOCK_CONVERSATION_ID },
        {
          token: "",
          isComplete: true,
          conversationId: MOCK_CONVERSATION_ID,
          messageId: "22222222-2222-4222-8222-222222222222",
          insufficientEvidence: false,
          citations: [],
        },
      ]),
    });
  }

  if (method === "GET" && path.startsWith("/conversations/")) {
    const now = new Date().toISOString();
    return json(route, { id: path.split("/")[2], title: "Mock conversation", createdAt: now, updatedAt: now, messages: [] });
  }

  if (method === "GET" && path === "/documents") {
    return json(route, []);
  }

  return json(route, { statusCode: 404, message: `No e2e mock for ${method} ${path}` }, 404);
}

export const test = base.extend<{ mockApi: void }>({
  mockApi: [
    async ({ page }, use) => {
      await page.route("**/api/v1/**", handleApi);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
