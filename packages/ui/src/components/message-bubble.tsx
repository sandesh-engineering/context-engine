"use client";

import * as React from "react";
import { CopyIcon, CheckIcon, BotIcon, UserIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string | Date;
  isStreaming?: boolean;
  className?: string;
}

export function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  className,
}: MessageBubbleProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback or ignore
    }
  };

  const isUser = role === "user";
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      data-slot="message-bubble"
      data-role={role}
      className={cn(
        "group relative flex w-full gap-3 py-2",
        isUser ? "justify-end" : "justify-start",
        className
      )}
    >
      {!isUser && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BotIcon className="size-4" />
        </div>
      )}

      <div
        className={cn(
          "relative flex max-w-[85%] sm:max-w-[75%] flex-col rounded-2xl px-4 py-3 text-sm shadow-xs transition-colors",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-xs"
            : "bg-muted/70 text-foreground rounded-tl-xs border border-border/50"
        )}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {content}
          {isStreaming && (
            <span
              className="inline-block size-2 ml-1 animate-pulse rounded-full bg-current align-middle"
              aria-label="Assistant typing"
            />
          )}
        </div>

        <div
          className={cn(
            "mt-1.5 flex items-center justify-between gap-2 text-[10px] opacity-70",
            isUser ? "text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {formattedTime && <span>{formattedTime}</span>}

          {!isUser && !isStreaming && content && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy message to clipboard"}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity rounded p-1 hover:bg-background/20"
            >
              {copied ? (
                <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CopyIcon className="size-3" />
              )}
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <UserIcon className="size-4" />
        </div>
      )}
    </div>
  );
}
