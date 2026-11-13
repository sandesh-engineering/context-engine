import { api } from "./api-client";

/**
 * Opens the stored file behind a citation in a new tab. PDFs jump to the cited
 * page. The backend only renders PDF and plain text inline; other types download.
 */
export function openCitedDocument(versionId: string, pageStart?: number): void {
  const url = api.documents.getDocumentFileUrl(versionId);
  // A noopener link opens exactly one tab; window.open with noopener returns
  // null even on success, so it can't be used to detect a blocked pop-up.
  const link = document.createElement("a");
  link.href = pageStart ? `${url}#page=${pageStart}` : url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}
