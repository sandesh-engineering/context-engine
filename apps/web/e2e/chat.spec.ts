import { expect, test, MOCK_ANSWER, MOCK_CONVERSATION_ID } from "./fixtures";

test.describe("Interactive Chat Interface", () => {
  test("renders empty state and prompt input", async ({ page }) => {
    await page.goto("/chat");

    await expect(
      page.getByText(/Ask questions and retrieve semantic insights/i)
    ).toBeVisible();

    const promptInput = page.getByTestId("chat-prompt-input");
    await expect(promptInput).toBeVisible();
    await expect(promptInput).toBeEmpty();
  });

  test("sends message on Enter and renders message bubbles", async ({
    page,
  }) => {
    await page.goto("/chat");

    const promptInput = page.getByTestId("chat-prompt-input");
    await promptInput.fill("What is the architecture overview?");
    await page.keyboard.press("Enter");

    // Expect user message bubble to appear (scoped to <main>: the sidebar also lists the new chat's title)
    const main = page.getByRole("main");
    await expect(main.getByText("What is the architecture overview?")).toBeVisible();

    // The mocked answer streams in on the new conversation's page
    await expect(page).toHaveURL(new RegExp(`/chat/${MOCK_CONVERSATION_ID}$`));
    await expect(main.getByText(MOCK_ANSWER)).toBeVisible();
  });

  test("creates a new conversation thread when clicking New Chat", async ({
    page,
  }) => {
    await page.goto("/chat");

    const newChatButton = page.getByTestId("new-chat-button");
    await expect(newChatButton).toBeVisible();
    await newChatButton.click();

    const promptInput = page.getByTestId("chat-prompt-input");
    await expect(promptInput).toBeVisible();
  });
});
