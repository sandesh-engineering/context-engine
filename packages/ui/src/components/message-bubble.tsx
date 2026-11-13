"use client";

import * as React from "react";
import {
  CopyIcon,
  CheckIcon,
  FileTextIcon,
  ArrowUpRightIcon,
  Loader2Icon,
  ShieldAlertIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Alert, AlertDescription, AlertTitle } from "./alert";

export interface CitationItem {
  chunkId: string;
  versionId?: string;
  documentTitle?: string;
  chunkIndex?: number;
  headingPath?: string;
  pageStart?: number;
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
  /** Opens the document behind a citation. Sources are clickable only when provided. */
  onOpenSource?: (citation: CitationItem) => Promise<void> | void;
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
          className="font-semibold text-foreground"
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
          className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
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
        <ol key={listKey} className="my-2 ml-5 flex list-decimal flex-col gap-1.5 marker:text-muted-foreground">
          {currentList.items.map((item, i) => (
            <li key={i} className="pl-1">
              {item}
            </li>
          ))}
        </ol>
      );
    } else {
      elements.push(
        <ul key={listKey} className="my-2 ml-5 flex list-disc flex-col gap-1.5 marker:text-muted-foreground">
          {currentList.items.map((item, i) => (
            <li key={i} className="pl-1">
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
      elements.push(<div key={`blank-${idx}`} className="h-1" aria-hidden="true" />);
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
        <h4 key={`h4-${idx}`} className="mt-4 mb-1 text-sm font-semibold tracking-tight text-foreground first:mt-0">
          {formatInlineText(line.slice(4))}
        </h4>
      );
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${idx}`} className="mt-5 mb-1 text-[15px] font-semibold tracking-tight text-foreground first:mt-0">
          {formatInlineText(line.slice(3))}
        </h3>
      );
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${idx}`} className="mt-5 mb-1.5 text-base font-semibold tracking-tight text-foreground first:mt-0">
          {formatInlineText(line.slice(2))}
        </h2>
      );
      return;
    }

    // Default line
    elements.push(
      <p key={`p-${idx}`} className="my-1.5 first:mt-0 last:mb-0">
        {formatInlineText(line)}
      </p>
    );
  });

  flushList();
  return elements;
}

const PENDING_STATUSES = [
  "Thinking",
  "Searching your documents",
  "Reading relevant passages",
  "Cross-checking sources",
  "Composing an answer",
];

/** Cycles through progress phrases while a reply has not produced text yet. */
function usePendingStatus(active: boolean, sourceCount: number) {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((i) => Math.min(i + 1, PENDING_STATUSES.length - 1));
    }, 1800);
    return () => clearInterval(timer);
  }, [active]);

  if (sourceCount > 0 && index >= 2) {
    return `Reading ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`;
  }
  return PENDING_STATUSES[index];
}

function SourceCard({
  citation,
  index,
  onOpen,
}: {
  citation: CitationItem;
  index: number;
  onOpen?: MessageBubbleProps["onOpenSource"];
}) {
  const [state, setState] = React.useState<"idle" | "opening" | "error">("idle");
  const canOpen = !!onOpen && !!citation.versionId;

  const title =
    citation.documentTitle ||
    citation.headingPath ||
    (citation.chunkIndex !== undefined ? `Passage ${citation.chunkIndex + 1}` : "Referenced passage");
  const details = [
    citation.documentTitle ? citation.headingPath : undefined,
    citation.pageStart ? `Page ${citation.pageStart}` : undefined,
  ].filter(Boolean);

  const handleOpen = async () => {
    if (!onOpen || state === "opening") return;
    setState("opening");
    try {
      await onOpen(citation);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const body = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
          {state === "error" ? (
            <span className="text-destructive">Could not open this document</span>
          ) : (
            <>
              {details.length > 0 && <span className="truncate">{details.join(", ")}</span>}
              {citation.similarity !== undefined && (
                <span className="shrink-0 font-mono tabular-nums">
                  {Math.round(citation.similarity * 100)}% match
                </span>
              )}
            </>
          )}
        </span>
      </span>
      {canOpen &&
        (state === "opening" ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <ArrowUpRightIcon
            className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/source:text-foreground"
            aria-hidden="true"
          />
        ))}
    </>
  );

  const cardClass =
    "group/source flex h-full w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-xs";

  if (!canOpen) {
    return <div className={cardClass}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={state === "opening"}
      aria-label={`Open source ${index + 1}: ${title}`}
      className={cn(
        cardClass,
        "cursor-pointer transition-colors hover:border-ring/60 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-progress"
      )}
    >
      {body}
    </button>
  );
}

export function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  citations,
  insufficientEvidence = false,
  onOpenSource,
  className,
}: MessageBubbleProps) {
  const [copied, setCopied] = React.useState(false);

  const isUser = role === "user";
  const isPending = isStreaming && !content;
  const pendingStatus = usePendingStatus(isPending, citations?.length ?? 0);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context); nothing to do.
    }
  };

  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // A question opens a new section of the transcript.
  if (isUser) {
    return (
      <div
        data-slot="message-bubble"
        data-role={role}
        className={cn("flex flex-col gap-2 not-first:border-t not-first:pt-12", className)}
      >
        <h3 className="text-xl leading-snug font-semibold tracking-tight break-words whitespace-pre-wrap text-foreground sm:text-2xl">
          {content}
        </h3>
        {formattedTime && (
          <span className="text-xs text-muted-foreground tabular-nums">Asked at {formattedTime}</span>
        )}
      </div>
    );
  }

  const sources = citations && citations.length > 0 ? citations : null;

  return (
    <div
      data-slot="message-bubble"
      data-role={role}
      className={cn("group flex flex-col gap-5", className)}
    >
      <div className="flex flex-col gap-2.5">
        <div className="text-sm font-medium text-muted-foreground">Answer</div>
        <div className="text-base leading-8 break-words text-foreground/90" aria-live="polite">
          {isPending ? (
            <span className="shimmer text-muted-foreground">{pendingStatus}...</span>
          ) : (
            <>
              {renderFormattedContent(content, false)}
              {isStreaming && (
                <span
                  className="ml-0.5 inline-block h-4.5 w-1.5 animate-pulse rounded-[1px] bg-foreground/60 align-[-3px]"
                  aria-label="Answer is still being written"
                />
              )}
            </>
          )}
        </div>
      </div>

      {sources && (
        <section className="flex flex-col gap-2.5" aria-label="Sources">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileTextIcon className="size-4" aria-hidden="true" />
            <span>Sources</span>
          </div>
          <ol className="grid gap-2 sm:grid-cols-2">
            {sources.map((cite, i) => (
              <li key={cite.chunkId || i} className="min-w-0">
                <SourceCard citation={cite} index={i} onOpen={onOpenSource} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {insufficientEvidence && (
        <Alert variant="warning">
          <ShieldAlertIcon />
          <AlertTitle>Not enough evidence</AlertTitle>
          <AlertDescription>
            Your indexed documents did not contain enough information to answer this reliably.
          </AlertDescription>
        </Alert>
      )}

      {!isStreaming && content && (
        <div className="-ml-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy answer to clipboard"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
          {formattedTime && <span className="tabular-nums">{formattedTime}</span>}
        </div>
      )}
    </div>
  );
}
