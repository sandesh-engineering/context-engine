"use client";

import * as React from "react";
import { useConversation } from "../../context/conversation-context";
import { ChatInput } from "../../components/chat/chat-input";
import { MessageBubble } from "@repo/ui/components/message-bubble";
import { MessageScroller } from "@repo/ui/components/message-scroller";
import { SparklesIcon } from "lucide-react";

export default function ChatPage() {
  const {
    conversations,
    activeConversationId,
    messages,
    hasMore,
    isLoadingMore,
    isSending,
    sendMessage,
    loadMore,
  } = useConversation();

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden bg-background">
      {/* Main chat message canvas */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex h-full flex-1 flex-col items-center justify-center p-6 text-center select-none">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3 shadow-2xs">
              <SparklesIcon className="size-5" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {activeConv?.title || "Ask Knowledge Engine"}
            </h2>
            <p className="max-w-sm text-xs text-muted-foreground mt-1">
              Ask questions to query and extract insights from your uploaded
              documents and resources.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col overflow-hidden">
            <MessageScroller
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
            >
              {messages.map((msg, index) => {
                const isLastAssistantMessage =
                  index === messages.length - 1 &&
                  msg.role === "assistant" &&
                  isSending;

                return (
                  <MessageBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.createdAt}
                    isStreaming={isLastAssistantMessage}
                  />
                );
              })}
            </MessageScroller>
          </div>
        )}
      </div>

      {/* Floating Prompt Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-background/90 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto max-w-3xl flex flex-col gap-1.5">
          <ChatInput onSend={sendMessage} isLoading={isSending} />
          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground/70">
            <span>RAG Context Search active</span>
            <span>Press <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded border border-border">Enter ↵</kbd> to send</span>
          </div>
        </div>
      </div>
    </div>
  );
}
