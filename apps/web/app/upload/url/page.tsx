"use client";

import * as React from "react";
import { Card, CardContent } from "@repo/ui/components/card";
import { PageContainer, PageHeader } from "../../../components/page-header";
import { UrlImportForm } from "../../../components/upload/url-import-form";
import { RecentIngestionsTable } from "../../../components/upload/recent-ingestions-table";

export default function UrlUploadPage() {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Public Resource URL Import"
        description="Import a public web page or hosted PDF. A background worker fetches it, extracts clean text and computes embeddings."
      />

      <Card className="py-0">
        <CardContent className="p-4 sm:p-6">
          <UrlImportForm onSuccess={handleSuccess} />
        </CardContent>
      </Card>

      <RecentIngestionsTable refreshKey={refreshKey} filterSource="URL" />
    </PageContainer>
  );
}
