"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon, LayersIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { useConversation } from "../../context/conversation-context";
import { ChatInput } from "../../components/chat/chat-input";

const SUGGESTED_PROMPTS = [
  "Summarize the key points in the documents",
  "What are the main requirements and constraints?",
  "Explain the technical architecture overview",
];

export default function NewChatPage() {
  const router = useRouter();
  const { sendMessage, isSending, setActiveConversationId } = useConversation();
  const [startError, setStartError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActiveConversationId(null);
  }, [setActiveConversationId]);

  const handleSend = async (text: string) => {
    setStartError(null);
    try {
      // Navigate as soon as the conversation exists so the question shows
      // immediately and the answer streams in on the conversation page.
      await sendMessage(text, undefined, {
        onConversationReady: (id) => router.push(`/chat/${id}`),
      });
    } catch (err: unknown) {
      setStartError(
        err instanceof Error ? err.message : "Could not start a conversation. Is the backend running?"
      );
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-4 py-12 sm:px-6 md:pb-[12vh]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-card text-foreground shadow-xs">
            <LayersIcon className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What would you like to know?
          </h2>
          <p className="max-w-[52ch] text-base leading-relaxed text-pretty text-muted-foreground">
            Ask questions and retrieve semantic insights from your uploaded documents. Every answer
            cites the passages it came from.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <ChatInput onSend={handleSend} isLoading={isSending} />
          {startError && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not send your question</AlertTitle>
              <AlertDescription>{startError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              variant="outline"
              onClick={() => handleSend(prompt)}
              disabled={isSending}
              className="h-9 rounded-full px-4 font-normal text-muted-foreground hover:text-foreground"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
