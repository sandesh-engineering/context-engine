"use client";

import * as React from "react";
import { UploadCloudIcon, FileTextIcon, XIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  onFileRemove?: () => void;
  selectedFile?: File | null;
  accept?: string;
  maxSizeBytes?: number;
  disabled?: boolean;
  className?: string;
  errorMessage?: string | null;
  onValidationError?: (message: string) => void;
}

export function FileDropzone({
  onFileSelect,
  onFileRemove,
  selectedFile = null,
  accept = "application/pdf,.pdf",
  maxSizeBytes,
  disabled = false,
  className,
  errorMessage,
  onValidationError,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const validateAndHandleFile = React.useCallback(
    (file: File) => {
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      if (!isPdf) {
        onValidationError?.("Invalid file format. Only PDF files are supported.");
        return;
      }

      if (maxSizeBytes && file.size > maxSizeBytes) {
        const maxMb = Math.round(maxSizeBytes / (1024 * 1024));
        onValidationError?.(`File exceeds limit of ${maxMb}MB.`);
        return;
      }

      onFileSelect(file);
    },
    [maxSizeBytes, onFileSelect, onValidationError]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        validateAndHandleFile(droppedFile);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file) {
        validateAndHandleFile(file);
      }
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className={cn("flex flex-col gap-4 w-full", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        aria-hidden="true"
        data-testid="file-dropzone-input"
      />

      {!selectedFile ? (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Upload PDF document dropzone"
          aria-disabled={disabled}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "group relative flex min-h-[220px] flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed p-10 sm:p-14 md:p-16 text-center transition-all cursor-pointer select-none",
            "border-border/80 bg-muted/20 hover:bg-muted/35 hover:border-primary/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isDragging && "border-primary bg-primary/10 scale-[0.99]",
            disabled && "cursor-not-allowed opacity-50 hover:bg-muted/20 hover:border-border/80"
          )}
        >
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-105 shadow-2xs">
            <UploadCloudIcon className="size-8" />
          </div>

          <div className="flex flex-col gap-2 max-w-sm px-2">
            <p className="text-sm md:text-base font-semibold tracking-tight text-foreground">
              Drop your PDF here, or{" "}
              <span className="text-primary underline underline-offset-4">browse files</span>
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Streams directly to storage. Supports multi-page books, technical papers, and large documents.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs">
          <div className="flex items-center gap-4 overflow-hidden">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-2xs">
              <FileTextIcon className="size-6" />
            </div>
            <div className="flex flex-col overflow-hidden text-left gap-0.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {selectedFile.name}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {formatFileSize(selectedFile.size)} · PDF Document
              </span>
            </div>
          </div>
          {onFileRemove && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (inputRef.current) inputRef.current.value = "";
                onFileRemove();
              }}
              aria-label="Remove selected file"
              className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            >
              <XIcon className="size-5" />
            </button>
          )}
        </div>
      )}

      {errorMessage && (
        <p className="text-xs font-medium text-destructive animate-in fade-in-50 px-1" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
