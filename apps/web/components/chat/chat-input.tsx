"use client";

import * as React from "react";
import { ArrowUpIcon, Loader2Icon, SquareIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Kbd } from "@repo/ui/components/kbd";
import { cn } from "@repo/ui/lib/utils";

export interface ChatInputProps {
  onSend: (message: string) => void;
  /** When provided, the send button turns into a stop button while `isLoading`. */
  onStop?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  isLoading = false,
  placeholder = "Ask anything about your documents...",
  className,
}: ChatInputProps) {
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const canSend = !!value.trim() && !disabled && !isLoading;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(value);
    setValue("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <form
        onSubmit={handleSubmit}
        onClick={() => textareaRef.current?.focus()}
        className="flex w-full cursor-text flex-col rounded-2xl border border-input bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 dark:bg-input/30"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isLoading}
          rows={1}
          aria-label="Chat message prompt input"
          data-testid="chat-prompt-input"
          className="field-sizing-content max-h-56 min-h-14 w-full resize-none bg-transparent px-4 pt-4 pb-1 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5">
          {isLoading && onStop ? (
            <Button
              type="button"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              aria-label="Stop generating"
              data-testid="stop-generating-button"
              className="rounded-lg"
            >
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label="Send message"
              data-testid="send-message-button"
              className="rounded-lg"
            >
              {isLoading ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
            </Button>
          )}
        </div>
      </form>
      <div className="flex items-center justify-between gap-4 px-1 text-xs text-muted-foreground">
        <span>Answers are grounded in your indexed documents.</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>Enter</Kbd> to send
        </span>
      </div>
    </div>
  );
}
