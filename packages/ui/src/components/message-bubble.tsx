"use client";

import * as React from "react";
import {
  CopyIcon,
  CheckIcon,
  BotIcon,
  UserIcon,
  FileTextIcon,
  ChevronDownIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { cn } from "../lib/utils";

export interface CitationItem {
  chunkId: string;
  versionId?: string;
  documentTitle?: string;
  chunkIndex?: number;
  headingPath?: string;
  similarity?: number;
  snippet?: string;
}

export interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string | Date;
  isStreaming?: boolean;
  citations?: CitationItem[];
  insufficientEvidence?: boolean;
  className?: string;
}

function formatInlineText(text: string): React.ReactNode[] {
  // Regex matches: **bold**, `code`, or regular text
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const boldText = part.slice(2, -2);
      return (
        <strong
          key={index}
          className="font-semibold text-foreground tracking-tight underline-offset-2"
        >
          {boldText}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeText = part.slice(1, -1);
      return (
        <code
          key={index}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground border border-border/50"
        >
          {codeText}
        </code>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function renderFormattedContent(rawText: string, isUser: boolean): React.ReactNode {
  if (isUser) {
    return <span className="whitespace-pre-wrap">{rawText}</span>;
  }

  const lines = rawText.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    const listKey = `list-${elements.length}`;
    if (currentList.type === 'ol') {
      elements.push(
        <ol key={listKey} className="my-2 ml-4 list-decimal space-y-1 pl-2">
          {currentList.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ol>
      );
    } else {
      elements.push(
        <ul key={listKey} className="my-2 ml-4 list-disc space-y-1 pl-2">
          {currentList.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      );
    }
    currentList = null;
  };

  lines.forEach((line, idx) => {
    // Blank line
    if (!line.trim()) {
      flushList();
      elements.push(<div key={`blank-${idx}`} className="h-2" />);
      return;
    }

    // Unordered list item: - or *
    if (/^[-*]\s+/.test(line)) {
      const itemText = line.replace(/^[-*]\s+/, '');
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(formatInlineText(itemText));
      return;
    }

    // Numbered list item: 1. or 2.
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch && numMatch[2] !== undefined) {
      const itemText = numMatch[2];
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(formatInlineText(itemText));
      return;
    }

    // Not a list item, flush any open list
    flushList();

    // Headings: ###, ##, #
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h4-${idx}`} className="font-semibold text-foreground text-sm mt-3 mb-1 tracking-tight">
          {formatInlineText(line.slice(4))}
        </h4>
      );
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${idx}`} className="font-bold text-foreground text-base mt-3.5 mb-1 tracking-tight">
          {formatInlineText(line.slice(3))}
        </h3>
      );
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${idx}`} className="font-bold text-foreground text-lg mt-4 mb-1.5 tracking-tight">
          {formatInlineText(line.slice(2))}
        </h2>
      );
      return;
    }

    // Default line
    elements.push(
      <p key={`p-${idx}`} className="my-1 leading-relaxed">
        {formatInlineText(line)}
      </p>
    );
  });

  flushList();
  return elements;
}

export function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  citations,
  insufficientEvidence = false,
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
          "relative flex max-w-[85%] sm:max-w-[75%] flex-col rounded-2xl px-4 py-3.5 text-sm shadow-xs transition-colors",
          isUser
            ? "bg-primary text-primary-foreground font-medium rounded-tr-xs"
            : "bg-card text-card-foreground rounded-tl-xs border border-border/80 shadow-2xs"
        )}
      >
        <div className="break-words leading-relaxed text-sm">
          {renderFormattedContent(content, isUser)}
          {isStreaming && (
            <span
              className="inline-block size-2 ml-1 animate-pulse rounded-full bg-current align-middle"
              aria-label="Assistant typing"
            />
          )}
        </div>

        {/* Insufficient Evidence Guardrail notice */}
        {insufficientEvidence && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20">
            <ShieldAlertIcon className="size-3.5 shrink-0" />
            <span>Strict Guardrail: Internal documentation contained insufficient evidence.</span>
          </div>
        )}

        {/* Sources & Citations list */}
        {citations && citations.length > 0 && !isStreaming && (
          <div className="mt-3 pt-2.5 border-t border-border/40">
            <details className="group/sources text-xs">
              <summary className="flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground cursor-pointer select-none">
                <FileTextIcon className="size-3.5 text-primary" />
                <span>Grounding Sources ({citations.length})</span>
                <ChevronDownIcon className="size-3 transition-transform group-open/sources:rotate-180 ml-auto" />
              </summary>
              <div className="mt-2 flex flex-col gap-1.5 pl-0.5">
                {citations.map((cite, i) => (
                  <div
                    key={cite.chunkId || i}
                    className="flex flex-col rounded-lg border border-border/50 bg-background/60 p-2.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                      <span className="truncate">
                        [{i + 1}] {cite.documentTitle || "Referenced Passage"}
                      </span>
                      {cite.similarity !== undefined && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {Math.round(cite.similarity * 100)}% match
                        </span>
                      )}
                    </div>
                    {cite.headingPath && (
                      <span className="text-[10px] text-muted-foreground italic truncate mt-0.5">
                        § {cite.headingPath}
                      </span>
                    )}
                    {cite.snippet && (
                      <p className="mt-1.5 text-muted-foreground/90 line-clamp-3 leading-relaxed bg-muted/30 p-2 rounded text-[10.5px] border border-border/30">
                        {cite.snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

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
