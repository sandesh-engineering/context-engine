"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquareIcon,
  FileUpIcon,
  GlobeIcon,
  LayersIcon,
  type LucideIcon,
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
  useSidebar,
} from "@repo/ui/components/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { useConversation } from "../context/conversation-context";
import { ConversationList } from "./chat/conversation-list";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  testId?: string;
}

const workspaceNav: NavItem[] = [
  {
    href: "/chat",
    label: "Chat",
    icon: MessageSquareIcon,
    isActive: (p) => p === "/" || p === "/chat",
    testId: "new-chat-button",
  },
];

const ingestNav: NavItem[] = [
  {
    href: "/upload/file",
    label: "PDF File Upload",
    icon: FileUpIcon,
    isActive: (p) => p.startsWith("/upload/file") || p === "/upload",
  },
  {
    href: "/upload/url",
    label: "URL Ingestion",
    icon: GlobeIcon,
    isActive: (p) => p.startsWith("/upload/url"),
  },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <LayersIcon className="size-4" />
      </div>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Knowledge Engine
      </span>
    </div>
  );
}

function NavMenu({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            isActive={item.isActive(pathname)}
            render={<Link href={item.href} onClick={onNavigate} data-testid={item.testId} />}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const { isMobile, mobileOpen, setMobileOpen } = useSidebar();
  const {
    conversations,
    activeConversationId,
    isLoadingConversations,
  } = useConversation();

  const closeOnMobile = React.useCallback(() => {
    if (isMobile) setMobileOpen(false);
  }, [isMobile, setMobileOpen]);

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : activeConversationId;

  const navContent = (
    <>
      <SidebarContent className="pt-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu items={workspaceNav} pathname={pathname} onNavigate={closeOnMobile} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Ingest</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu items={ingestNav} pathname={pathname} onNavigate={closeOnMobile} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0">
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <ConversationList
              conversations={conversations}
              activeId={activeChatId}
              onNavigate={closeOnMobile}
              isLoading={isLoadingConversations}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

    </>
  );

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <BrandMark />
        </SidebarHeader>
        {navContent}
      </Sidebar>

      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
            <SheetHeader className="flex h-14 flex-row items-center px-3">
              <SheetTitle className="sr-only">Knowledge Engine navigation</SheetTitle>
              <BrandMark />
            </SheetHeader>
            {navContent}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
