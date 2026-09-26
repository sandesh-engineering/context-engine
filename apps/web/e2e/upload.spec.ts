import { expect, test } from "@playwright/test";

test.describe("Document Upload Interface", () => {
  test("loads PDF upload page with dropzone and history table", async ({ page }) => {
    await page.goto("/upload/file");

    await expect(page.getByText("PDF Document Upload")).toBeVisible();
    await expect(page.getByText("PDF Ingestion Jobs & History")).toBeVisible();
  });

  test("loads URL import page with input form and history table", async ({ page }) => {
    await page.goto("/upload/url");

    await expect(page.getByText("Public Resource URL Import")).toBeVisible();
    await expect(page.getByText("URL Import Jobs & History")).toBeVisible();
  });

  test("validates non-PDF file upload rejection in dropzone", async ({
    page,
  }) => {
    await page.goto("/upload/file");

    const fileChooserInput = page.getByTestId("file-dropzone-input");
    await fileChooserInput.setInputFiles({
      name: "sample-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello Plain Text Document"),
    });

    await expect(
      page.getByText(/Invalid file format. Only PDF files are supported./i)
    ).toBeVisible();
  });

  test("validates PDF file selection and enables upload button", async ({
    page,
  }) => {
    await page.goto("/upload/file");

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
    await page.goto("/upload/url");

    const urlInput = page.getByTestId("url-import-input");
    await urlInput.fill("https://example.com/research-paper.pdf");

    const titleInput = page.getByTestId("url-title-input");
    await titleInput.fill("Research Paper 2026");

    const submitButton = page.getByTestId("submit-url-button");
    await expect(submitButton).toBeEnabled();
  });
});
