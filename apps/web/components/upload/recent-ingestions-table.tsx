"use client";

import * as React from "react";
import type { IngestionJob } from "@repo/api";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  FilePlus2Icon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { getApiErrorMessage } from "@repo/api";
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
  /* Document a new version is being uploaded for, or that is being deleted */
  const [busyDocumentId, setBusyDocumentId] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<{ documentId: string; name: string } | null>(null);
  const versionInputRef = React.useRef<HTMLInputElement>(null);
  const versionTargetRef = React.useRef<string | null>(null);

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

  const chooseVersionFile = (documentId: string) => {
    versionTargetRef.current = documentId;
    versionInputRef.current?.click();
  };

  const handleVersionFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const documentId = versionTargetRef.current;
    /* Reset so choosing the same file again still fires onChange */
    event.target.value = "";
    if (!file || !documentId) return;

    setBusyDocumentId(documentId);
    setActionNotice(null);
    try {
      const res = await api.documents.uploadDocumentVersion(documentId, file);
      setActionNotice(
        res.data.duplicate
          ? { tone: "success", text: "This file is identical to the current version, so there was nothing new to index." }
          : {
              tone: "success",
              text: `Version ${res.data.versionNumber} uploaded. The previous version keeps answering until this one is indexed.`,
            },
      );
      await fetchJobs();
    } catch (err: unknown) {
      setActionNotice({ tone: "error", text: getApiErrorMessage(err, "Failed to upload the new version.") });
    } finally {
      setBusyDocumentId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { documentId, name } = pendingDelete;
    setPendingDelete(null);
    setBusyDocumentId(documentId);
    setActionNotice(null);
    try {
      await api.documents.deleteDocument(documentId);
      setActionNotice({ tone: "success", text: `"${name}" was deleted and no longer appears in answers.` });
      await fetchJobs();
    } catch (err: unknown) {
      setActionNotice({ tone: "error", text: getApiErrorMessage(err, "Failed to delete the document.") });
    } finally {
      setBusyDocumentId(null);
    }
  };

  /* Statuses come from the backend's IngestionJobStatus: PENDING | PROCESSING | COMPLETED | FAILED */
  const getStatusBadge = (status: string, errorMessage?: string) => {
    const s = status.toUpperCase();
    switch (s) {
      case "COMPLETED":
        return (
          <Badge variant="success">
            <CheckCircle2Icon />
            Available
          </Badge>
        );
      case "PROCESSING":
        return (
          <Badge variant="info">
            <Loader2Icon className="animate-spin" />
            Processing
          </Badge>
        );
      case "FAILED":
        return (
          /* Temporary failures are retried by the queue; a broken file fails for good. The reason shows on hover */
          <Badge variant="destructive" title={errorMessage}>
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
        return s === "PENDING" || s === "PROCESSING";
      }
      if (activeTab === "completed") {
        return s === "COMPLETED";
      }
      if (activeTab === "failed") {
        return s === "FAILED";
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

      <input
        ref={versionInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleVersionFile}
        data-testid="version-file-input"
      />

      {actionNotice && (
        <Alert variant={actionNotice.tone === "error" ? "destructive" : "success"} aria-live="polite">
          {actionNotice.tone === "error" ? <AlertCircleIcon /> : <CheckCircle2Icon />}
          <AlertDescription>{actionNotice.text}</AlertDescription>
        </Alert>
      )}

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
                  const name = job.filename || job.url || job.title || "Untitled";
                  const SourceIcon = job.sourceType === "URL" ? GlobeIcon : FileTextIcon;
                  /* Only the row of a document's current version offers actions */
                  const canAct = Boolean(job.documentId) && job.isCurrent !== false;
                  const isBusy = busyDocumentId !== null && busyDocumentId === job.documentId;

                  return (
                    <tr key={job.id} className="transition-colors hover:bg-muted/30">
                      <td className="max-w-0 px-4 py-3 sm:w-[55%]">
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <SourceIcon className="size-4" />
                          </div>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium text-foreground" title={name}>
                                {name}
                              </span>
                              {job.versionNumber !== undefined && job.versionNumber > 1 && (
                                <Badge variant="outline" className="shrink-0 font-mono">
                                  v{job.versionNumber}
                                </Badge>
                              )}
                              {job.isCurrent === false && (
                                <Badge variant="muted" className="shrink-0" title="A newer version of this document answers questions now">
                                  Replaced
                                </Badge>
                              )}
                            </span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground" title={job.id}>
                              {job.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(job.status, job.errorMessage)}</td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                        {new Date(job.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canAct && (
                          <div className="inline-flex items-center gap-1">
                            {isBusy ? (
                              <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Working" />
                            ) : (
                              <>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => chooseVersionFile(job.documentId!)}
                                  disabled={busyDocumentId !== null}
                                  aria-label={`Upload a new version of ${name}`}
                                  title="Upload new version"
                                >
                                  <FilePlus2Icon />
                                </Button>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => setPendingDelete({ documentId: job.documentId!, name })}
                                  disabled={busyDocumentId !== null}
                                  aria-label={`Delete ${name}`}
                                  title="Delete document"
                                >
                                  <Trash2Icon />
                                </Button>
                              </>
                            )}
                          </div>
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

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.name}&rdquo; and all its versions will be removed. It stops appearing in
              answers immediately, and its citations in earlier chats will no longer open.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} data-testid="confirm-delete-button">
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
