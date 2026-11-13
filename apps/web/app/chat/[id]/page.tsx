"use client";

import * as React from "react";
import { useConversation } from "../../../context/conversation-context";
import { ChatInput } from "../../../components/chat/chat-input";
import { MessageBubble } from "@repo/ui/components/message-bubble";
import { MessageScroller } from "@repo/ui/components/message-scroller";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { CitationItem } from "@repo/ui/components/message-bubble";
import { openCitedDocument } from "../../../lib/open-document";

const openSource = (citation: CitationItem) =>
  citation.versionId ? openCitedDocument(citation.versionId, citation.pageStart) : undefined;

function ConversationSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-10 sm:px-6" aria-label="Loading conversation">
      <Skeleton className="h-7 w-3/5" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </div>
  );
}

export default function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = React.use(params);
  const convId = resolvedParams.id;

  const {
    messages,
    hasMore,
    isLoadingMessages,
    isLoadingMore,
    isSending,
    sendMessage,
    stopGenerating,
    loadMore,
    selectConversation,
    activeConversationId,
  } = useConversation();

  React.useEffect(() => {
    if (convId && convId !== activeConversationId) {
      selectConversation(convId);
    }
  }, [convId, activeConversationId, selectConversation]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoadingMessages && messages.length === 0 ? (
          <ConversationSkeleton />
        ) : (
          <MessageScroller
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            className="px-4 sm:px-6"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
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
                    onOpenSource={openSource}
                  />
                );
              })}
            </div>
          </MessageScroller>
        )}
      </div>

      <div className="shrink-0 bg-gradient-to-t from-background from-75% to-transparent px-4 pt-3 pb-5 sm:px-6">
        <ChatInput
          onSend={(text) => sendMessage(text, convId)}
          onStop={() => stopGenerating(convId)}
          isLoading={isSending}
          placeholder="Ask a follow-up..."
          className="mx-auto max-w-3xl"
        />
      </div>
    </div>
  );
}
