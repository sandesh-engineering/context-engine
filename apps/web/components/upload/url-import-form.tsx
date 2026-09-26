"use client";

import * as React from "react";
import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import { GlobeIcon, CheckCircle2Icon, AlertCircleIcon, Loader2Icon, ArrowUpRightIcon } from "lucide-react";
import { api } from "../../lib/api-client";

export interface UrlImportFormProps {
  onSuccess?: () => void;
}

export function UrlImportForm({ onSuccess }: UrlImportFormProps) {
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [status, setStatus] = React.useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setErrorMessage("Please enter a valid URL.");
      return;
    }

    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setErrorMessage("URL must begin with http:// or https://");
        return;
      }
    } catch {
      setErrorMessage("Please enter a valid URL format (e.g. https://example.com/doc.pdf).");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await api.documents.importFromUrl({
        sourceUrl: trimmedUrl,
        documentTitle: title.trim() || undefined,
      });

      setJobId(res.importId);
      setStatus("success");
      onSuccess?.();
    } catch (err: unknown) {
      console.error("URL import failed:", err);
      setStatus("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to queue URL ingestion. Please check the address."
      );
    }
  };

  const resetForm = () => {
    setUrl("");
    setTitle("");
    setStatus("idle");
    setErrorMessage(null);
    setJobId(null);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="url-input" className="text-xs font-semibold text-foreground">
          Public Resource URL <span className="text-destructive">*</span>
        </label>
        <div className="relative flex items-center">
          <GlobeIcon className="absolute left-3.5 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="https://example.com/research-paper.pdf"
            disabled={status === "submitting"}
            className="pl-10 h-11 text-sm rounded-xl"
            required
            data-testid="url-import-input"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Link to publicly accessible web documentation, whitepapers, or online PDF documents.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="title-input" className="text-xs font-semibold text-foreground">
          Custom Document Title <span className="text-muted-foreground font-normal">(Optional)</span>
        </label>
        <Input
          id="title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Q3 Financial Architecture Report"
          disabled={status === "submitting"}
          className="h-11 text-sm rounded-xl"
          data-testid="url-title-input"
        />
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs font-medium text-destructive animate-in fade-in-50">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {status === "success" && (
        <div className="flex items-start gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2Icon className="size-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-sm">Ingestion Job Queued!</span>
            <p className="text-emerald-700/90 dark:text-emerald-300/90 leading-relaxed">
              The external resource will be fetched, parsed, and embedded asynchronously in the background.
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-[11px] text-muted-foreground">Job ID: {jobId}</span>
              <span>·</span>
              <button
                type="button"
                onClick={resetForm}
                className="font-semibold text-emerald-700 dark:text-emerald-300 underline underline-offset-2 hover:opacity-80"
              >
                Import another URL
              </button>
            </div>
          </div>
        </div>
      )}

      {status !== "success" && (
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={status === "submitting" || !url.trim()}
            size="lg"
            className="w-full sm:w-auto font-semibold gap-2 px-6 h-10 shadow-xs"
            data-testid="submit-url-button"
          >
            {status === "submitting" ? (
              <>
                <Loader2Icon className="size-4 animate-spin mr-1" />
                Queueing Ingestion...
              </>
            ) : (
              <>
                <span>Queue URL Ingestion</span>
                <ArrowUpRightIcon className="size-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </form>
  );
}
