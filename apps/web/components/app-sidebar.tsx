"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquareIcon,
  UploadCloudIcon,
  PlusIcon,
  LayersIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@repo/ui/components/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { Button } from "@repo/ui/components/button";
import { useConversation } from "../context/conversation-context";
import { cn } from "@repo/ui/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, mobileOpen, setMobileOpen, expanded } = useSidebar();
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createNewConversation,
    isLoadingConversations,
  } = useConversation();

  const isChat = pathname === "/" || pathname?.startsWith("/chat");
  const isUpload = pathname?.startsWith("/upload");

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    if (isMobile) setMobileOpen(false);
  };

  const handleNewChat = async () => {
    await createNewConversation();
    if (isMobile) setMobileOpen(false);
  };

  const navContent = (
    <div className="flex h-full flex-col justify-between select-none">
      <div className="flex flex-col gap-4">
        {/* Main View Switcher */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <Link
                  href="/chat"
                  onClick={() => isMobile && setMobileOpen(false)}
                  className="w-full"
                >
                  <SidebarMenuButton
                    isActive={isChat}
                    className={cn(
                      "gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      isChat
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <MessageSquareIcon className="size-4 shrink-0" />
                    <span className="truncate">Chat</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <Link
                  href="/upload"
                  onClick={() => isMobile && setMobileOpen(false)}
                  className="w-full"
                >
                  <SidebarMenuButton
                    isActive={isUpload}
                    className={cn(
                      "gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      isUpload
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <UploadCloudIcon className="size-4 shrink-0" />
                    <span className="truncate">Document Upload</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Conversation Threads */}
        <SidebarGroup className="flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Chats
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={handleNewChat}
              aria-label="New Chat"
              data-testid="new-chat-button"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted gap-1 rounded-md"
            >
              <PlusIcon className="size-3.5" />
              <span className="text-[11px] font-medium">New</span>
            </Button>
          </div>

          <SidebarGroupContent className="flex flex-col gap-0.5 overflow-y-auto max-h-[calc(100vh-280px)] pr-1">
            {isLoadingConversations && conversations.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground animate-pulse">
                Loading chats...
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground/60">
                No previous conversations
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = isChat && conv.id === activeConversationId;
                return (
                  <Link
                    key={conv.id}
                    href="/chat"
                    onClick={() => handleSelectConversation(conv.id)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-all",
                      isActive
                        ? "bg-accent font-medium text-accent-foreground shadow-2xs"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <MessageSquareIcon className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                    <span className="truncate flex-1">
                      {conv.title || "Untitled Chat"}
                    </span>
                  </Link>
                );
              })
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </div>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border/60 p-3">
        <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-medium">System Online</span>
          </div>
          <span className="font-mono text-[10px] opacity-70">v1.0</span>
        </div>
      </SidebarFooter>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <Sidebar className="w-64 border-r border-border bg-card/60 backdrop-blur-md">
        <SidebarHeader className="flex h-14 items-center justify-between px-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
              <LayersIcon className="size-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Knowledge Engine
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="p-3">{navContent}</SidebarContent>
      </Sidebar>

      {/* Mobile Sheet Drawer */}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col bg-background">
            <SheetHeader className="h-14 px-4 border-b border-border flex flex-row items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LayersIcon className="size-4" />
              </div>
              <SheetTitle className="text-sm font-semibold">
                Knowledge Engine
              </SheetTitle>
            </SheetHeader>
            <div className="p-3 flex-1 overflow-y-auto">{navContent}</div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
