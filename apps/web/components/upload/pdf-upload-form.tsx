"use client";

import * as React from "react";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { CheckCircle2Icon, AlertCircleIcon, Loader2Icon, ArrowUpRightIcon } from "lucide-react";
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
    <div className="flex flex-col gap-6">
      <FileDropzone
        selectedFile={file}
        onFileSelect={handleFileSelect}
        onFileRemove={resetForm}
        disabled={status === "uploading"}
        errorMessage={errorMessage}
        onValidationError={handleValidationError}
      />

      {status === "uploading" && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin text-primary" />
              Uploading & Streaming Document to Storage...
            </span>
            <span className="text-muted-foreground font-mono font-semibold">{progress}%</span>
          </div>
          <Progress value={progress} max={100} />
        </div>
      )}

      {status === "success" && (
        <div className="flex items-start gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2Icon className="size-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-sm">Upload Successful</span>
            <p className="text-emerald-700/90 dark:text-emerald-300/90 leading-relaxed">
              Document has been securely saved and queued for background text extraction & vector embeddings.
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-[11px] text-muted-foreground">ID: {documentId}</span>
              <span>·</span>
              <button
                type="button"
                onClick={resetForm}
                className="font-semibold text-emerald-700 dark:text-emerald-300 underline underline-offset-2 hover:opacity-80"
              >
                Upload another PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "error" && errorMessage && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-5 text-destructive">
          <AlertCircleIcon className="size-5 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-sm">Upload Failed</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {file && status === "idle" && (
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleUpload}
            size="lg"
            className="w-full sm:w-auto font-semibold gap-2 px-6 h-10 shadow-xs"
            data-testid="start-upload-button"
          >
            <span>Upload Document</span>
            <ArrowUpRightIcon className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
