"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquareIcon,
  FileUpIcon,
  GlobeIcon,
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
import { cn } from "@repo/ui/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, mobileOpen, setMobileOpen } = useSidebar();

  const isChat = pathname === "/" || pathname?.startsWith("/chat");
  const isUploadFile = pathname?.startsWith("/upload/file") || pathname === "/upload";
  const isUploadUrl = pathname?.startsWith("/upload/url");

  const navContent = (
    <div className="flex h-full flex-col justify-between select-none">
      <div className="flex flex-col gap-4">
        {/* Main View Switcher */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              <SidebarMenuItem>
                <Link
                  href="/chat"
                  onClick={() => isMobile && setMobileOpen(false)}
                  className="w-full"
                >
                  <SidebarMenuButton
                    isActive={isChat}
                    className={cn(
                      "gap-3 rounded-xl px-3 py-2.5 text-xs font-medium",
                      isChat
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs transition-none"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-100"
                    )}
                  >
                    <MessageSquareIcon className="size-4 shrink-0" />
                    <span className="truncate text-xs font-medium">Chat Workspace</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <Link
                  href="/upload/file"
                  onClick={() => isMobile && setMobileOpen(false)}
                  className="w-full"
                >
                  <SidebarMenuButton
                    isActive={isUploadFile}
                    className={cn(
                      "gap-3 rounded-xl px-3 py-2.5 text-xs font-medium",
                      isUploadFile
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs transition-none"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-100"
                    )}
                  >
                    <FileUpIcon className="size-4 shrink-0" />
                    <span className="truncate text-xs font-medium">PDF File Ingestion</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <Link
                  href="/upload/url"
                  onClick={() => isMobile && setMobileOpen(false)}
                  className="w-full"
                >
                  <SidebarMenuButton
                    isActive={isUploadUrl}
                    className={cn(
                      "gap-3 rounded-xl px-3 py-2.5 text-xs font-medium",
                      isUploadUrl
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs transition-none"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-100"
                    )}
                  >
                    <GlobeIcon className="size-4 shrink-0" />
                    <span className="truncate text-xs font-medium">Public URL Ingestion</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
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
      <Sidebar className="border-r border-border bg-card/60 backdrop-blur-md">
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
