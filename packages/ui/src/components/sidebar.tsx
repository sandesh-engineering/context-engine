"use client";
import * as React from "react";
import { PanelLeftIcon } from "lucide-react";
import { cn } from "../lib/utils";

type SidebarContextType = {
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
  isMobile: boolean;
  mobileOpen: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SidebarContext = React.createContext<SidebarContextType | undefined>(
  undefined
);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

export function SidebarProvider({
  defaultExpanded = true,
  children,
  className,
}: {
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [isMobile, setIsMobile] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setMobileOpen((prev) => !prev);
    } else {
      setExpanded((prev) => !prev);
    }
  }, [isMobile]);

  return (
    <SidebarContext.Provider
      value={{
        expanded,
        setExpanded,
        toggleSidebar,
        isMobile,
        mobileOpen,
        setMobileOpen,
      }}
    >
      <div
        data-slot="sidebar-wrapper"
        className={cn(
          "flex min-h-screen w-full bg-background text-foreground",
          className
        )}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"aside">) {
  const { expanded } = useSidebar();

  return (
    <aside
      data-slot="sidebar"
      data-expanded={expanded}
      className={cn(
        "hidden md:flex md:flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,opacity] duration-200 ease-in-out overflow-hidden",
        expanded ? "w-64 opacity-100" : "w-0 opacity-0 border-none pointer-events-none",
        className
      )}
      {...props}
    >
      <div className="w-64 h-full flex flex-col shrink-0">
        {children}
      </div>
    </aside>
  );
}

export function SidebarHeader({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="sidebar-header"
      className={cn("flex h-14 items-center px-4 border-b border-sidebar-border gap-2", className)}
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-3",
        className
      )}
      {...props}
    />
  );
}

export function SidebarGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { expanded } = useSidebar();
  if (!expanded) return null;
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "px-2 py-1 text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider",
        className
      )}
      {...props}
    />
  );
}

export function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarMenu({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex flex-col gap-1 list-none p-0 m-0", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("relative list-none", className)}
      {...props}
    />
  );
}

interface SidebarMenuButtonProps extends React.ComponentProps<"button"> {
  isActive?: boolean;
  tooltip?: string;
}

export function SidebarMenuButton({
  className,
  isActive = false,
  children,
  ...props
}: SidebarMenuButtonProps) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-xs transition-none"
          : "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="sidebar-footer"
      className={cn("flex items-center p-3 border-t border-sidebar-border gap-2", className)}
      {...props}
    />
  );
}

export function SidebarTrigger({
  className,
  ...props
}: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label="Toggle Sidebar"
      onClick={toggleSidebar}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}
