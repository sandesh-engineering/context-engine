"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@repo/ui/components/card";
import { UrlImportForm } from "../../../components/upload/url-import-form";
import { RecentIngestionsTable } from "../../../components/upload/recent-ingestions-table";

export default function UrlUploadPage() {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="flex-1 overflow-y-auto w-full flex justify-center bg-background px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="w-full max-w-5xl flex flex-col gap-10">
        {/* Header */}
        <div className="flex flex-col gap-1.5 border-b border-border/60 pb-6">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-0.5 rounded-md w-fit">
              Web Crawl Ingestion
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Public Resource URL Import
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Crawl and ingest web pages, online documentation sites, and remote PDF resources into your knowledge base.
          </p>
        </div>

        {/* Upload Execution Canvas */}
        <Card className="border-border/80 bg-card shadow-xs rounded-2xl p-0 overflow-hidden">
          <CardHeader className="p-6 md:p-8 pb-5 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-base sm:text-lg tracking-tight font-semibold">
              Enter Public Web Resource URL
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
              Provide an HTTPS URL. Background workers will crawl the target, extract clean markdown/text, and compute embeddings.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 md:p-8">
            <UrlImportForm onSuccess={handleSuccess} />
          </CardContent>
        </Card>

        {/* URL Ingestion History */}
        <div className="pt-2">
          <RecentIngestionsTable refreshKey={refreshKey} filterSource="URL" />
        </div>
      </div>
    </div>
  );
}
