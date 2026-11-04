"use client";

import * as React from "react";
import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
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

  const isSubmitting = status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="url-input" className="text-sm font-medium text-foreground">
          Resource URL
        </label>
        <div className="relative flex items-center">
          <GlobeIcon
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (errorMessage) setErrorMessage(null);
              if (status === "error") setStatus("idle");
            }}
            placeholder="https://example.com/research-paper.pdf"
            disabled={isSubmitting}
            aria-invalid={!!errorMessage && status !== "error"}
            aria-describedby="url-input-help"
            className="h-11 pl-9 md:text-base"
            required
            data-testid="url-import-input"
          />
        </div>
        {errorMessage && status !== "error" ? (
          <p id="url-input-help" className="text-[13px] text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : (
          <p id="url-input-help" className="text-[13px] text-muted-foreground">
            A publicly reachable web page, documentation site or hosted PDF.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="title-input" className="text-sm font-medium text-foreground">
          Title <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Q3 Financial Architecture Report"
          disabled={isSubmitting}
          className="h-11 md:text-base"
          data-testid="url-title-input"
        />
      </div>

      {status === "error" && errorMessage && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {status === "success" ? (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>Import queued</AlertTitle>
          <AlertDescription>
            <p>The resource will be fetched, parsed and embedded in the background.</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-[11px] text-muted-foreground">Job {jobId}</span>
              <Button variant="link" size="xs" className="h-auto px-0" onClick={resetForm}>
                Import another URL
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting || !url.trim()}
            size="lg"
            className="w-full px-4 sm:w-auto"
            data-testid="submit-url-button"
          >
            {isSubmitting ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ArrowUpRightIcon data-icon="inline-start" />
            )}
            {isSubmitting ? "Queueing..." : "Import URL"}
          </Button>
        </div>
      )}
    </form>
  );
}
