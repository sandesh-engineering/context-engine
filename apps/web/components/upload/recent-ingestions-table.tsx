"use client";

import * as React from "react";
import type { IngestionJob, IngestionStatus } from "@repo/api";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { api } from "../../lib/api-client";
import { cn } from "@repo/ui/lib/utils";

export interface RecentIngestionsTableProps {
  refreshKey?: number;
  filterSource?: "FILE" | "URL";
}

type StatusTab = "all" | "active" | "completed" | "failed";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

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
        return (
          <Badge variant="success">
            <CheckCircle2Icon />
            Available
          </Badge>
        );
      case "PROCESSING":
      case "RUNNING":
        return (
          <Badge variant="info">
            <Loader2Icon className="animate-spin" />
            Processing
          </Badge>
        );
      case "CANCELLED":
        return (
          <Badge variant="muted">
            <BanIcon />
            Cancelled
          </Badge>
        );
      case "FAILED":
        return (
          <Badge variant="destructive">
            <XCircleIcon />
            Failed
          </Badge>
        );
      case "PENDING":
      default:
        return (
          <Badge variant="warning">
            <ClockIcon />
            Pending
          </Badge>
        );
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
    ? "Extraction and indexing status for uploaded PDFs."
    : filterSource === "URL"
    ? "Fetch and indexing status for imported URLs."
    : "Status of recent document processing tasks.";

  const EmptyIcon = filterSource === "URL" ? GlobeIcon : FileTextIcon;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ingestions-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 id="ingestions-heading" className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as StatusTab)}>
            <TabsList aria-label="Filter jobs by status">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button
            size="icon-sm"
            variant="ghost"
            onClick={fetchJobs}
            disabled={isLoading}
            aria-label="Refresh ingestion jobs list"
          >
            <RefreshCwIcon className={cn(isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {isLoading && jobs.length === 0 ? (
          <div className="flex flex-col divide-y" aria-label="Loading ingestion jobs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : filteredJobs.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia>
                <EmptyIcon />
              </EmptyMedia>
              <EmptyTitle>No jobs found</EmptyTitle>
              <EmptyDescription>
                {activeTab !== "all"
                  ? `No ${STATUS_TABS.find((t) => t.value === activeTab)?.label.toLowerCase()} jobs right now.`
                  : filterSource === "URL"
                  ? "Import a URL above to start your first ingestion job."
                  : "Upload a PDF above to start your first ingestion job."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="h-9 px-4 font-medium">
                    Document
                  </th>
                  <th scope="col" className="h-9 px-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="hidden h-9 px-4 font-medium sm:table-cell">
                    Added
                  </th>
                  <th scope="col" className="h-9 px-4 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredJobs.map((job) => {
                  const s = (job.status || "PENDING").toUpperCase();
                  const isCancelable = s === "PENDING" || s === "PROCESSING" || s === "RUNNING";
                  const isResumable = s === "FAILED" || s === "CANCELLED";
                  const isOperating = actionInProgress === job.id;
                  const name = job.filename || job.url || job.title || "Untitled";
                  const SourceIcon = job.sourceType === "URL" ? GlobeIcon : FileTextIcon;

                  return (
                    <tr key={job.id} className="transition-colors hover:bg-muted/30">
                      <td className="max-w-0 px-4 py-3 sm:w-[55%]">
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <SourceIcon className="size-4" />
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-medium text-foreground" title={name}>
                              {name}
                            </span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground" title={job.id}>
                              {job.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(job.status)}</td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                        {new Date(job.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isCancelable && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleCancelJob(job.id)}
                            disabled={isOperating}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            {isOperating ? (
                              <Loader2Icon data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <XIcon data-icon="inline-start" />
                            )}
                            Cancel
                          </Button>
                        )}

                        {isResumable && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleRetryJob(job.id)}
                            disabled={isOperating}
                          >
                            {isOperating ? (
                              <Loader2Icon data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <RotateCcwIcon data-icon="inline-start" />
                            )}
                            Resume
                          </Button>
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
    </section>
  );
}
