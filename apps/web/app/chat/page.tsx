"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConversation } from "../../context/conversation-context";
import { ChatInput } from "../../components/chat/chat-input";
import { SparklesIcon } from "lucide-react";

export default function NewChatPage() {
  const router = useRouter();
  const { sendMessage, isSending, setActiveConversationId } = useConversation();

  React.useEffect(() => {
    setActiveConversationId(null);
  }, [setActiveConversationId]);

  const handleSend = async (text: string) => {
    const newConvId = await sendMessage(text);
    if (newConvId) {
      router.push(`/chat/${newConvId}`);
    }
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-background">
      {/* Empty State Hero */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center select-none">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3 shadow-2xs">
          <SparklesIcon className="size-6" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Ask Knowledge Engine
        </h2>
        <p className="max-w-sm text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Ask questions to query and extract insights from your uploaded documents and resources.
        </p>

        {/* Suggestion Prompts */}
        <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-md">
          {[
            "Summarize the key points in the documents",
            "What are the main requirements and constraints?",
            "Explain the technical architecture overview",
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleSend(prompt)}
              className="rounded-full border border-border/80 bg-card/60 px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer select-none text-left"
            >
              {prompt} →
            </button>
          ))}
        </div>
      </div>

      {/* Floating Prompt Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-background/90 px-4 py-3.5 backdrop-blur-md">
        <div className="mx-auto max-w-3xl flex flex-col gap-1.5">
          <ChatInput onSend={handleSend} isLoading={isSending} />
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
