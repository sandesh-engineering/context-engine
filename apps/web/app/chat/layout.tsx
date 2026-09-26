"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useConversation } from "../../context/conversation-context";
import { PlusIcon, MessageSquareIcon, Loader2Icon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    conversations,
    activeConversationId,
    createNewConversation,
    isLoadingConversations,
  } = useConversation();

  const handleNewChat = async () => {
    const newConv = await createNewConversation();
    router.push(`/chat/${newConv.id}`);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background">
      {/* Left Chat Threads Sidebar */}
      <div className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/80 bg-card/40 select-none">
        <div className="flex items-center justify-between p-3.5 border-b border-border/60">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Conversations
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={handleNewChat}
            data-testid="new-chat-button"
            className="h-7 px-2.5 text-xs gap-1.5 rounded-lg shadow-2xs"
          >
            <PlusIcon className="size-3.5" />
            <span>New Chat</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {isLoadingConversations && conversations.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>Loading threads...</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-3">
              <MessageSquareIcon className="size-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-semibold text-foreground">No conversations yet</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Start a new chat to ask questions</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = pathname === `/chat/${conv.id}` || activeConversationId === conv.id;
              return (
                <Link
                  key={conv.id}
                  href={`/chat/${conv.id}`}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs transition-none",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <MessageSquareIcon className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
                  <span className="truncate flex-1 font-medium">
                    {conv.title || "Untitled Chat"}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Canvas */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
    </div>
  );
}
