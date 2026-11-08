"use client";

import { Card, CardContent } from "@repo/ui/components/card";
import { PageContainer, PageHeader } from "../../../components/page-header";
import { UrlImportForm } from "../../../components/upload/url-import-form";
import { RecentIngestionsTable } from "../../../components/upload/recent-ingestions-table";

export default function UrlUploadPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Public Resource URL Import"
        description="Import a hosted PDF from a public or S3 link. Coming soon."
      />

      <Card className="py-0">
        <CardContent className="p-4 sm:p-6">
          <UrlImportForm />
        </CardContent>
      </Card>

      <RecentIngestionsTable filterSource="URL" />
    </PageContainer>
  );
}
