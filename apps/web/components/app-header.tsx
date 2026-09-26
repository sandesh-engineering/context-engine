"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@repo/ui/components/sidebar";
import { Badge } from "@repo/ui/components/badge";

export function AppHeader() {
  const pathname = usePathname();

  const getPageTitle = () => {
    if (pathname?.startsWith("/upload/url")) return "Public URL Ingestion";
    if (pathname?.startsWith("/upload/file") || pathname?.startsWith("/upload")) return "PDF Document Ingestion";
    if (pathname?.startsWith("/chat") || pathname === "/") return "Interactive Chat";
    return "Knowledge Engine";
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <div className="h-4 w-px bg-border" />
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          {getPageTitle()}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="outline" className="hidden sm:inline-flex text-[11px] font-mono">
          Tenant: default
        </Badge>
      </div>
    </header>
  );
}
