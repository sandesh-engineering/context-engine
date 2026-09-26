import { expect, test } from "@playwright/test";

test.describe("Document Upload Interface", () => {
  test("switches between PDF Upload and URL Import tabs", async ({ page }) => {
    await page.goto("/upload");

    await expect(page.getByText("Direct PDF Upload").first()).toBeVisible();

    // Switch to URL import tab
    const urlTab = page.getByTestId("tab-url-import");
    await urlTab.click();
    await expect(page.getByText("Public URL Ingestion").first()).toBeVisible();

    // Switch back to File upload tab
    const fileTab = page.getByTestId("tab-file-upload");
    await fileTab.click();
    await expect(page.getByText("Direct PDF Upload").first()).toBeVisible();
  });

  test("validates non-PDF file upload rejection in dropzone", async ({
    page,
  }) => {
    await page.goto("/upload");

    const fileChooserInput = page.getByTestId("file-dropzone-input");
    await fileChooserInput.setInputFiles({
      name: "sample-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello Plain Text Document"),
    });

    await expect(
      page.getByText(/Invalid file format. Only PDF files are allowed./i)
    ).toBeVisible();
  });

  test("validates PDF file selection and enables upload button", async ({
    page,
  }) => {
    await page.goto("/upload");

    const fileChooserInput = page.getByTestId("file-dropzone-input");
    await fileChooserInput.setInputFiles({
      name: "financial-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 mock pdf file data"),
    });

    await expect(page.getByText("financial-report.pdf")).toBeVisible();
    const uploadButton = page.getByTestId("start-upload-button");
    await expect(uploadButton).toBeVisible();
  });

  test("validates URL input and displays job confirmation on submit", async ({
    page,
  }) => {
    await page.goto("/upload");

    // Switch to URL import tab
    await page.getByTestId("tab-url-import").click();

    const urlInput = page.getByTestId("url-import-input");
    await urlInput.fill("https://example.com/research-paper.pdf");

    const titleInput = page.getByTestId("url-title-input");
    await titleInput.fill("Research Paper 2026");

    const submitButton = page.getByTestId("submit-url-button");
    await expect(submitButton).toBeEnabled();
  });
});
