"use client";

import * as React from "react";
import Link from "next/link";
import type { Conversation } from "@repo/api";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { Skeleton } from "@repo/ui/components/skeleton";

export interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onNavigate?: () => void;
  isLoading?: boolean;
  /** Shown instead of the empty-state text when the list could not be loaded. */
  loadError?: string | null;
}

export function ConversationList({
  conversations,
  activeId,
  onNavigate,
  isLoading = false,
  loadError = null,
}: ConversationListProps) {
  if (isLoading && conversations.length === 0) {
    return (
      <div className="flex flex-col gap-2.5 px-2 py-1.5" aria-label="Loading conversations">
        {[72, 56, 64].map((w) => (
          <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (conversations.length === 0 && loadError) {
    return (
      <p className="px-2 py-1 text-xs leading-relaxed text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
        Your conversations will appear here.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {conversations.map((conv) => (
        <SidebarMenuItem key={conv.id}>
          <SidebarMenuButton
            isActive={conv.id === activeId}
            render={<Link href={`/chat/${conv.id}`} onClick={onNavigate} />}
            className="font-normal"
          >
            <span>{conv.title || "Untitled chat"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
