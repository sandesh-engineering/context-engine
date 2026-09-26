"use client";

import * as React from "react";
import { SendIcon, Loader2Icon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/lib/utils";

export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  placeholder = "Ask a question about your uploaded documents...",
  className,
}: ChatInputProps) {
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value.trim() || disabled || isLoading) return;
    onSend(value);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "relative flex w-full items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-xs transition-all focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        className
      )}
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isLoading}
        rows={1}
        aria-label="Chat message prompt input"
        data-testid="chat-prompt-input"
        className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!value.trim() || disabled || isLoading}
        aria-label="Send message"
        data-testid="send-message-button"
        className="size-9 shrink-0 rounded-xl"
      >
        {isLoading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <SendIcon className="size-4" />
        )}
      </Button>
    </form>
  );
}
