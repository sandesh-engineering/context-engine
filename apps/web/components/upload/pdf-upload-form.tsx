"use client";

import * as React from "react";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { CheckCircle2Icon, AlertCircleIcon, Loader2Icon, ArrowUpIcon, FilePlus2Icon, InfoIcon } from "lucide-react";
import { getApiErrorMessage, type DocumentFilenameMatch } from "@repo/api";
import { api } from "../../lib/api-client";

export interface PdfUploadFormProps {
  onSuccess?: () => void;
}

export function PdfUploadForm({ onSuccess }: PdfUploadFormProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<number>(0);
  const [status, setStatus] = React.useState<
    "idle" | "checking" | "confirm" | "uploading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [documentId, setDocumentId] = React.useState<string | null>(null);
  /* Documents whose current file has the same name: the user decides whether this replaces one */
  const [filenameMatches, setFilenameMatches] = React.useState<DocumentFilenameMatch[]>([]);
  const [successText, setSuccessText] = React.useState<string>("");

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
    if (!file || status === "uploading" || status === "checking") return;

    setStatus("checking");
    setErrorMessage(null);

    let matches: DocumentFilenameMatch[] = [];
    try {
      matches = await api.documents.findFilenameMatches(file.name);
    } catch (err: unknown) {
      /* The hint is optional: if the lookup fails, upload as a separate document */
      console.warn("Filename lookup failed:", err);
    }

    if (matches.length > 0) {
      setFilenameMatches(matches);
      setStatus("confirm");
      return;
    }
    await performUpload();
  };

  /* Without a target document the file becomes a new document */
  const performUpload = async (targetDocumentId?: string) => {
    if (!file) return;

    setStatus("uploading");
    setProgress(10);
    setErrorMessage(null);
    setFilenameMatches([]);

    const onUploadProgress = (progressEvent: { loaded: number; total?: number }) => {
      if (progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setProgress(Math.max(10, percent));
      } else {
        setProgress((prev) => Math.min(prev + 15, 90));
      }
    };

    try {
      const res = targetDocumentId
        ? await api.documents.uploadDocumentVersion(targetDocumentId, file, { onUploadProgress })
        : await api.documents.uploadDocument(file, { onUploadProgress });

      setProgress(100);
      setStatus("success");
      setDocumentId(res.data.documentId);
      setSuccessText(
        res.data.duplicate
          ? "This exact file was already uploaded, so there is nothing new to index."
          : targetDocumentId
          ? `Saved as version ${res.data.versionNumber}. The previous version keeps answering until this one is indexed. Track its progress below.`
          : "The document is queued for text extraction and embedding. Track its progress below."
      );
      onSuccess?.();
    } catch (err: unknown) {
      console.error("Upload failed:", err);
      setStatus("error");
      /* Shows the backend's reason, e.g. "Only valid PDF documents are allowed" */
      setErrorMessage(
        getApiErrorMessage(err, "Failed to upload document. Please verify network and backend service.")
      );
    }
  };

  const resetForm = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setErrorMessage(null);
    setDocumentId(null);
    setFilenameMatches([]);
    setSuccessText("");
  };

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        selectedFile={file}
        onFileSelect={handleFileSelect}
        onFileRemove={resetForm}
        disabled={status === "uploading" || status === "checking"}
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
            <p>{successText}</p>
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

      {status === "confirm" && (
        <Alert variant="warning" data-testid="version-prompt">
          <InfoIcon />
          <AlertTitle>A document with this file name already exists</AlertTitle>
          <AlertDescription>
            <p>
              Is <span className="font-medium text-foreground">{file?.name}</span> a new version? A new version
              replaces the old one in answers once it is indexed. Otherwise both stay searchable.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {filenameMatches.map((match) => (
                <Button
                  key={match.documentId}
                  size="sm"
                  onClick={() => performUpload(match.documentId)}
                  data-testid="upload-as-version-button"
                >
                  <FilePlus2Icon data-icon="inline-start" />
                  New version of &ldquo;{match.title}&rdquo; (v{match.versionNumber + 1})
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => performUpload()} data-testid="upload-as-new-button">
                Keep as a separate document
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {file && (status === "idle" || status === "error" || status === "checking") && (
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            size="lg"
            className="w-full px-4 sm:w-auto"
            data-testid="start-upload-button"
            disabled={status === "checking"}
          >
            {status === "checking" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ArrowUpIcon data-icon="inline-start" />
            )}
            {status === "error" ? "Retry upload" : "Upload document"}
          </Button>
        </div>
      )}
    </div>
  );
}
