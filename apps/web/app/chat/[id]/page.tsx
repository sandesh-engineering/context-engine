"use client";

import * as React from "react";
import { useConversation } from "../../../context/conversation-context";
import { ChatInput } from "../../../components/chat/chat-input";
import { MessageBubble } from "@repo/ui/components/message-bubble";
import { MessageScroller } from "@repo/ui/components/message-scroller";
import { SparklesIcon, Loader2Icon } from "lucide-react";

export default function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = React.use(params);
  const convId = resolvedParams.id;

  const {
    conversations,
    messages,
    hasMore,
    isLoadingMessages,
    isLoadingMore,
    isSending,
    sendMessage,
    loadMore,
    selectConversation,
    activeConversationId,
  } = useConversation();

  React.useEffect(() => {
    if (convId && convId !== activeConversationId) {
      selectConversation(convId);
    }
  }, [convId, activeConversationId, selectConversation]);

  const activeConv = conversations.find((c) => c.id === convId);

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-background">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border/50 bg-card/30">
        <div className="flex items-center gap-2 overflow-hidden">
          <SparklesIcon className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {activeConv?.title || "Conversation"}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">ID: {convId}</span>
      </div>

      {/* Message stream */}
      <div className="flex-1 overflow-hidden">
        {isLoadingMessages && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs gap-2">
            <Loader2Icon className="size-4 animate-spin text-primary" />
            <span>Loading conversation messages...</span>
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
                    citations={msg.citations}
                    insufficientEvidence={msg.insufficientEvidence}
                  />
                );
              })}
            </MessageScroller>
          </div>
        )}
      </div>

      {/* Floating Prompt Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-background/90 px-4 py-3.5 backdrop-blur-md">
        <div className="mx-auto max-w-3xl flex flex-col gap-1.5">
          <ChatInput onSend={(text) => sendMessage(text, convId)} isLoading={isSending} />
          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground/70">
            <span>RAG Context Search active</span>
            <span>
              Press <kbd className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border">Enter ↵</kbd> to send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
