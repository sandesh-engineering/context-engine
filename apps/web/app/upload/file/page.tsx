"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@repo/ui/components/card";
import { PdfUploadForm } from "../../../components/upload/pdf-upload-form";
import { RecentIngestionsTable } from "../../../components/upload/recent-ingestions-table";

export default function PdfUploadPage() {
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
              Direct File Ingestion
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            PDF Document Upload
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Upload multi-page PDF documents, research papers, and books for vector indexing and semantic retrieval.
          </p>
        </div>

        {/* Upload Execution Canvas */}
        <Card className="border-border/80 bg-card shadow-xs rounded-2xl p-0 overflow-hidden">
          <CardHeader className="p-6 md:p-8 pb-5 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-base sm:text-lg tracking-tight font-semibold">
              Select or Drop PDF File
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
              Drag and drop your file below. Streaming pipeline processes embeddings and chunks asynchronously without file size barriers.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 md:p-8">
            <PdfUploadForm onSuccess={handleSuccess} />
          </CardContent>
        </Card>

        {/* PDF Ingestion History */}
        <div className="pt-2">
          <RecentIngestionsTable refreshKey={refreshKey} filterSource="FILE" />
        </div>
      </div>
    </div>
  );
}
