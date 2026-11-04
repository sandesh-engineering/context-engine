"use client";

import * as React from "react";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { CheckCircle2Icon, AlertCircleIcon, Loader2Icon, ArrowUpIcon } from "lucide-react";
import { api } from "../../lib/api-client";

export interface PdfUploadFormProps {
  onSuccess?: () => void;
}

export function PdfUploadForm({ onSuccess }: PdfUploadFormProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<number>(0);
  const [status, setStatus] = React.useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [documentId, setDocumentId] = React.useState<string | null>(null);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setStatus("idle");
    setErrorMessage(null);
    setProgress(0);
  };

  const handleValidationError = (msg: string) => {
    setErrorMessage(msg);
  };

  const handleUpload = async () => {
    if (!file || status === "uploading") return;

    setStatus("uploading");
    setProgress(10);
    setErrorMessage(null);

    try {
      const res = await api.documents.uploadDocument(file, {
        onUploadProgress: (progressEvent: { loaded: number; total?: number }) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setProgress(Math.max(10, percent));
          } else {
            setProgress((prev) => Math.min(prev + 15, 90));
          }
        },
      });

      setProgress(100);
      setStatus("success");
      setDocumentId(res.data.documentId);
      onSuccess?.();
    } catch (err: unknown) {
      console.error("Upload failed:", err);
      setStatus("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to upload document. Please verify network and backend service."
      );
    }
  };

  const resetForm = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setErrorMessage(null);
    setDocumentId(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        selectedFile={file}
        onFileSelect={handleFileSelect}
        onFileRemove={resetForm}
        disabled={status === "uploading"}
        errorMessage={status === "error" ? null : errorMessage}
        onValidationError={handleValidationError}
      />

      {status === "uploading" && (
        <div className="flex flex-col gap-2.5 px-0.5" aria-live="polite">
          <div className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
              Uploading to storage
            </span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} max={100} className="h-1.5" />
        </div>
      )}

      {status === "success" && (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>Upload complete</AlertTitle>
          <AlertDescription>
            <p>The document is queued for text extraction and embedding. Track its progress below.</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-[11px] text-muted-foreground">ID {documentId}</span>
              <Button variant="link" size="xs" className="h-auto px-0" onClick={resetForm}>
                Upload another PDF
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {status === "error" && errorMessage && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {file && (status === "idle" || status === "error") && (
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            size="lg"
            className="w-full px-4 sm:w-auto"
            data-testid="start-upload-button"
          >
            <ArrowUpIcon data-icon="inline-start" />
            {status === "error" ? "Retry upload" : "Upload document"}
          </Button>
        </div>
      )}
    </div>
  );
}
