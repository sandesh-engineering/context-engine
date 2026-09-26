"use client";

import * as React from "react";
import type { IngestionJob, IngestionStatus } from "@repo/api";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  FileTextIcon,
  GlobeIcon,
  RefreshCwIcon,
  Loader2Icon,
  XCircleIcon,
  RotateCcwIcon,
  BanIcon,
} from "lucide-react";
import { api } from "../../lib/api-client";
import { cn } from "@repo/ui/lib/utils";

export interface RecentIngestionsTableProps {
  refreshKey?: number;
  filterSource?: "FILE" | "URL";
}

type StatusTab = "all" | "active" | "completed" | "failed";

export function RecentIngestionsTable({
  refreshKey,
  filterSource,
}: RecentIngestionsTableProps) {
  const [jobs, setJobs] = React.useState<IngestionJob[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<StatusTab>("all");
  const [actionInProgress, setActionInProgress] = React.useState<string | null>(null);

  const fetchJobs = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.documents.getRecentIngestions(30);
      const filtered = filterSource
        ? res.filter((j) => (j.sourceType || "FILE").toUpperCase() === filterSource.toUpperCase())
        : res;
      setJobs(filtered);
    } catch (err: unknown) {
      console.warn("Failed to fetch recent ingestions from API:", err);
      setJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, [filterSource]);

  React.useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshKey]);

  const handleCancelJob = async (jobId: string) => {
    try {
      setActionInProgress(jobId);
      await api.documents.cancelJob(jobId);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: "CANCELLED" as IngestionStatus } : j
        )
      );
    } catch (err: unknown) {
      console.error("Failed to cancel job:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      setActionInProgress(jobId);
      await api.documents.retryJob(jobId);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: "PENDING" as IngestionStatus } : j
        )
      );
    } catch (err: unknown) {
      console.error("Failed to retry job:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    switch (s) {
      case "AVAILABLE":
      case "COMPLETED":
        return <Badge variant="success" className="px-2.5 py-0.5 font-medium">AVAILABLE</Badge>;
      case "PROCESSING":
      case "RUNNING":
        return (
          <Badge variant="info" className="px-2.5 py-0.5 font-medium flex items-center gap-1">
            <Loader2Icon className="size-3 animate-spin" />
            <span>RUNNING</span>
          </Badge>
        );
      case "CANCELLED":
        return (
          <Badge variant="secondary" className="px-2.5 py-0.5 font-medium text-muted-foreground bg-muted flex items-center gap-1">
            <BanIcon className="size-3" />
            <span>CANCELLED</span>
          </Badge>
        );
      case "FAILED":
        return <Badge variant="destructive" className="px-2.5 py-0.5 font-medium">FAILED</Badge>;
      case "PENDING":
      default:
        return <Badge variant="warning" className="px-2.5 py-0.5 font-medium">PENDING</Badge>;
    }
  };

  // Filter jobs based on active tab
  const filteredJobs = React.useMemo(() => {
    return jobs.filter((job) => {
      const s = (job.status || "PENDING").toUpperCase();
      if (activeTab === "active") {
        return s === "PENDING" || s === "PROCESSING" || s === "RUNNING";
      }
      if (activeTab === "completed") {
        return s === "AVAILABLE" || s === "COMPLETED";
      }
      if (activeTab === "failed") {
        return s === "FAILED" || s === "CANCELLED";
      }
      return true;
    });
  }, [jobs, activeTab]);

  const title = filterSource === "FILE"
    ? "PDF Ingestion Jobs & History"
    : filterSource === "URL"
    ? "URL Import Jobs & History"
    : "Recent Ingestion Jobs & History";

  const description = filterSource === "FILE"
    ? "Live queue of pending, running, completed, and cancelled PDF document extraction tasks"
    : filterSource === "URL"
    ? "Live queue of pending, running, completed, and cancelled public web crawling jobs"
    : "Queue and history of running, pending, and finished document processing tasks";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {/* Status Filter Pills */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/40 text-xs">
            {(["all", "active", "completed", "failed"] as StatusTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-medium capitalize transition-none",
                  activeTab === tab
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {tab === "failed" ? "Failed / Cancelled" : tab}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={fetchJobs}
            disabled={isLoading}
            aria-label="Refresh ingestion jobs list"
            className="h-8 px-3 text-xs gap-1.5 text-muted-foreground hover:text-foreground rounded-xl"
          >
            <RefreshCwIcon
              className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        {isLoading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-3">
            <Loader2Icon className="size-4 animate-spin text-primary" />
            <span>Loading ingestion jobs...</span>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
              {filterSource === "URL" ? <GlobeIcon className="size-6" /> : <FileTextIcon className="size-6" />}
            </div>
            <p className="text-sm font-semibold text-foreground">
              No jobs found
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
              {activeTab !== "all"
                ? `No ${activeTab} ingestion jobs in the current queue.`
                : filterSource === "URL"
                ? "Provide a public URL above to start an asynchronous ingestion job."
                : "Select or drop a PDF file above to start uploading and indexing."}
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
                  <th scope="col" className="px-6 py-4">
                    Date
                  </th>
                  <th scope="col" className="px-6 py-4 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredJobs.map((job) => {
                  const s = (job.status || "PENDING").toUpperCase();
                  const isCancelable = s === "PENDING" || s === "PROCESSING" || s === "RUNNING";
                  const isResumable = s === "FAILED" || s === "CANCELLED";
                  const isOperating = actionInProgress === job.id;

                  return (
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
                      <td className="px-6 py-4.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(job.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-4.5 text-right whitespace-nowrap">
                        {isCancelable && (
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => handleCancelJob(job.id)}
                            disabled={isOperating}
                            className="h-7 px-2.5 text-[11px] gap-1 rounded-lg"
                          >
                            {isOperating ? (
                              <Loader2Icon className="size-3 animate-spin" />
                            ) : (
                              <XCircleIcon className="size-3.5" />
                            )}
                            <span>Cancel</span>
                          </Button>
                        )}

                        {isResumable && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleRetryJob(job.id)}
                            disabled={isOperating}
                            className="h-7 px-2.5 text-[11px] gap-1 rounded-lg border-primary/40 text-primary hover:bg-primary/10"
                          >
                            {isOperating ? (
                              <Loader2Icon className="size-3 animate-spin" />
                            ) : (
                              <RotateCcwIcon className="size-3.5" />
                            )}
                            <span>Resume</span>
                          </Button>
                        )}

                        {!isCancelable && !isResumable && (
                          <span className="text-[11px] text-muted-foreground/60 font-mono">
                            Completed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
