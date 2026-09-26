"use client";

import * as React from "react";
import { FileUpIcon, GlobeIcon, ChevronRightIcon } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@repo/ui/components/card";
import { PdfUploadForm } from "../../components/upload/pdf-upload-form";
import { UrlImportForm } from "../../components/upload/url-import-form";
import { RecentIngestionsTable } from "../../components/upload/recent-ingestions-table";
import { cn } from "@repo/ui/lib/utils";

type UploadMode = "file" | "url";

export default function UploadPage() {
  const [mode, setMode] = React.useState<UploadMode>("file");
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const OPTIONS = [
    {
      id: "file" as UploadMode,
      title: "Direct PDF Upload",
      description: "Upload local PDF files, books, whitepapers, and multi-page technical reports",
      icon: FileUpIcon,
    },
    {
      id: "url" as UploadMode,
      title: "Public Resource URL",
      description: "Crawl web pages, documentation sites, and online hosted PDF resources",
      icon: GlobeIcon,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto w-full flex flex-col items-center bg-background px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="w-full max-w-5xl flex flex-col gap-10">
        {/* Page Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md w-fit">
              Ingestion Pipeline
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Document Ingestion
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Index and process knowledge sources into vector embeddings for fast semantic retrieval and RAG chat.
          </p>
        </div>

        {/* Two-Column Ingestion Workspace */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Left Column: Source Selection */}
          <div className="md:col-span-5 flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 px-1">
              <span className="text-xs font-semibold text-foreground tracking-tight">
                Source Type
              </span>
              <span className="text-[11px] text-muted-foreground">
                Choose how you want to provide documents
              </span>
            </div>

            <div className="flex flex-col gap-3.5">
              {OPTIONS.map((opt) => {
                const isActive = mode === opt.id;
                const Icon = opt.icon;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    data-active={isActive}
                    data-testid={`tab-${opt.id === "file" ? "file-upload" : "url-import"}`}
                    className={cn(
                      "group flex items-start gap-4 rounded-2xl border p-5 sm:p-6 text-left transition-all select-none cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isActive
                        ? "border-primary bg-primary/5 text-foreground shadow-xs ring-1 ring-primary/30"
                        : "border-border/80 bg-card/70 hover:bg-muted/40 hover:border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-xl transition-all mt-0.5",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm scale-105"
                          : "bg-muted text-muted-foreground group-hover:text-foreground group-hover:bg-muted/80"
                      )}
                    >
                      <Icon className="size-5" />
                    </div>

                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-sm font-semibold tracking-tight",
                            isActive ? "text-foreground" : "text-foreground/90"
                          )}
                        >
                          {opt.title}
                        </span>
                        {isActive && (
                          <ChevronRightIcon className="size-4 text-primary shrink-0" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        {opt.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Execution Form Canvas */}
          <div className="md:col-span-7">
            <Card className="border-border/80 bg-card shadow-xs rounded-2xl p-0 overflow-hidden">
              <CardHeader className="p-6 md:p-8 pb-5 border-b border-border/50 bg-muted/10">
                <CardTitle className="text-base sm:text-lg tracking-tight font-semibold">
                  {mode === "file" ? "Upload PDF Document" : "Import Public URL"}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {mode === "file"
                    ? "Drag and drop your PDF below. Uploaded files stream directly to storage and are queued for text extraction and vector chunking."
                    : "Enter an online URL. Background workers will crawl, extract readable content, and index into your knowledge base."}
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 md:p-8">
                {mode === "file" ? (
                  <PdfUploadForm onSuccess={handleSuccess} />
                ) : (
                  <UrlImportForm onSuccess={handleSuccess} />
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Recent Ingestion Activity */}
        <div className="border-t border-border/70 pt-10">
          <RecentIngestionsTable refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}
