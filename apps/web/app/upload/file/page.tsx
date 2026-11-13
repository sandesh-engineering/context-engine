"use client";

import * as React from "react";
import { PageContainer, PageHeader } from "../../../components/page-header";
import { PdfUploadForm } from "../../../components/upload/pdf-upload-form";
import { RecentIngestionsTable } from "../../../components/upload/recent-ingestions-table";

export default function PdfUploadPage() {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <PageContainer>
      <PageHeader
        title="PDF Document Upload"
        description="Upload PDFs, research papers and books. Each file is chunked, embedded and indexed in the background so it becomes searchable in chat."
      />

      <PdfUploadForm onSuccess={handleSuccess} />

      <RecentIngestionsTable refreshKey={refreshKey} filterSource="FILE" />
    </PageContainer>
  );
}
