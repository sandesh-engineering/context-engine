"use client";

import * as React from "react";
import type { IngestionJob } from "@repo/api";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  FileTextIcon,
  GlobeIcon,
  RefreshCwIcon,
  Loader2Icon,
} from "lucide-react";
import { api } from "../../lib/api-client";

export interface RecentIngestionsTableProps {
  refreshKey?: number;
}

export function RecentIngestionsTable({
  refreshKey,
}: RecentIngestionsTableProps) {
  const [jobs, setJobs] = React.useState<IngestionJob[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchJobs = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.documents.getRecentIngestions();
      setJobs(res);
    } catch (err: unknown) {
      console.warn("Failed to fetch recent ingestions from API:", err);
      setJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshKey]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return <Badge variant="success" className="px-2.5 py-0.5 font-medium">AVAILABLE</Badge>;
      case "PROCESSING":
        return <Badge variant="info" className="px-2.5 py-0.5 font-medium">PROCESSING</Badge>;
      case "FAILED":
        return <Badge variant="destructive" className="px-2.5 py-0.5 font-medium">FAILED</Badge>;
      case "PENDING":
      default:
        return <Badge variant="warning" className="px-2.5 py-0.5 font-medium">PENDING</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            Recent Ingestion Activity
          </h3>
          <p className="text-xs text-muted-foreground">
            Historical log of processed PDF documents and crawled web URLs
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={fetchJobs}
          disabled={isLoading}
          aria-label="Refresh ingestion jobs list"
          className="h-8 px-3 text-xs gap-1.5 text-muted-foreground hover:text-foreground rounded-lg"
        >
          <RefreshCwIcon
            className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          <span>Refresh</span>
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        {isLoading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-3">
            <Loader2Icon className="size-4 animate-spin text-primary" />
            <span>Loading ingestion activity...</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
              <FileTextIcon className="size-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No recent documents ingested
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
              Upload a PDF document or import a public URL above to start indexing.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/70 bg-muted/40 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                <tr>
                  <th scope="col" className="px-6 py-4">
                    Source / Document
                  </th>
                  <th scope="col" className="px-6 py-4">
                    Type
                  </th>
                  <th scope="col" className="px-6 py-4">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-4 text-right">
                    Ingested Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-6 py-4.5">
                      <div className="flex items-center gap-3.5 max-w-sm truncate">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          {job.sourceType === "FILE" ? (
                            <FileTextIcon className="size-4" />
                          ) : (
                            <GlobeIcon className="size-4" />
                          )}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span
                            className="font-semibold text-foreground truncate text-xs"
                            title={job.filename || job.url || job.title || "Untitled"}
                          >
                            {job.filename || job.url || job.title || "Untitled"}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">
                            ID: {job.id}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <span className="font-mono text-[11px] text-muted-foreground px-2 py-0.5 rounded-md bg-muted/60 border border-border/40">
                        {job.sourceType || "FILE"}
                      </span>
                    </td>
                    <td className="px-6 py-4.5">{getStatusBadge(job.status)}</td>
                    <td className="px-6 py-4.5 text-right font-mono text-[11px] text-muted-foreground">
                      {new Date(job.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
