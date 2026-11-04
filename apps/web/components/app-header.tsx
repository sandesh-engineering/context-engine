"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { SidebarTrigger } from "@repo/ui/components/sidebar";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";
import { useConversation } from "../context/conversation-context";
import { ThemeToggle } from "./theme-toggle";

function getPageTitle(pathname: string) {
  if (pathname.startsWith("/upload/url")) return "Public URL Ingestion";
  if (pathname.startsWith("/upload")) return "PDF Document Ingestion";
  if (pathname.startsWith("/chat") || pathname === "/") return "Interactive Chat";
  return "Knowledge Engine";
}

export function AppHeader() {
  const pathname = usePathname() ?? "/";
  const { conversations } = useConversation();

  const conversationId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;
  const conversationTitle = conversationId
    ? (conversations.find((c) => c.id === conversationId)?.title ?? "Untitled chat")
    : null;

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-sm sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 my-4.5" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <h1
          className={cn(
            "font-medium",
            conversationTitle ? "shrink-0 text-muted-foreground" : "truncate text-foreground"
          )}
        >
          {getPageTitle(pathname)}
        </h1>
        {conversationTitle && (
          <>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="truncate font-medium text-foreground" aria-current="page">
              {conversationTitle}
            </span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center">
        <ThemeToggle />
      </div>
    </header>
  );
}
