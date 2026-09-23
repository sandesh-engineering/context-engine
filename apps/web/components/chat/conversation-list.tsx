"use client";

import * as React from "react";
import type { Conversation } from "@repo/api";
import { PlusIcon, MessageSquareIcon, Loader2Icon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

export interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  isLoading?: boolean;
  className?: string;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  isLoading = false,
  className,
}: ConversationListProps) {
  return (
    <div
      className={cn(
        "flex flex-col h-full w-full border-r border-border bg-card/40 p-3 select-none",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Conversations
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={onNewChat}
          className="gap-1.5 text-xs h-7 px-2.5"
          data-testid="new-chat-button"
        >
          <PlusIcon className="size-3.5" />
          <span>New Chat</span>
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {isLoading && conversations.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs gap-2">
            <Loader2Icon className="size-4 animate-spin" />
            <span>Loading threads...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-2">
            <MessageSquareIcon className="size-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs font-medium text-muted-foreground">
              No conversations yet
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Start a new chat to ask questions
            </p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeId;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                data-active={isActive}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-all",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-accent text-accent-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground"
                )}
              >
                <MessageSquareIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate flex-1">{conv.title || "Untitled Chat"}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
