"use client";

import * as React from "react";
import { UploadCloudIcon, FileTextIcon, XIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";

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
            "group relative flex min-h-60 cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-input bg-card/60 p-8 text-center transition-colors select-none sm:p-12",
            "hover:border-ring hover:bg-muted/60",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
            isDragging && "border-foreground/40 bg-muted",
            disabled && "cursor-not-allowed opacity-50 hover:border-input hover:bg-muted/30"
          )}
        >
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-xs transition-colors group-hover:text-foreground">
            <UploadCloudIcon className="size-6" />
          </div>

          <div className="flex max-w-md flex-col gap-1.5">
            <p className="text-base font-medium text-foreground">
              Drop a PDF here, or{" "}
              <span className="underline decoration-muted-foreground/50 underline-offset-4 group-hover:decoration-foreground">
                browse
              </span>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Multi-page books, papers and large documents are streamed straight to storage.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 pr-3 shadow-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileTextIcon className="size-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 text-left">
              <span className="truncate text-sm font-medium text-foreground">
                {selectedFile.name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                PDF, {formatFileSize(selectedFile.size)}
              </span>
            </div>
          </div>
          {onFileRemove && !disabled && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                if (inputRef.current) inputRef.current.value = "";
                onFileRemove();
              }}
              aria-label="Remove selected file"
            >
              <XIcon />
            </Button>
          )}
        </div>
      )}

      {errorMessage && (
        <p className="px-0.5 text-[13px] text-destructive animate-in fade-in-50" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
