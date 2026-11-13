"use client";
import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
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
        "sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,opacity] duration-200 ease-out md:flex md:flex-col",
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
      className={cn("flex h-14 shrink-0 items-center gap-2 px-3", className)}
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
        "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 py-2",
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
        "flex h-7 items-center px-2 text-xs font-medium text-sidebar-foreground/60",
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
      className={cn("m-0 flex list-none flex-col gap-0.5 p-0", className)}
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

type SidebarMenuButtonProps = useRender.ComponentProps<"button"> & {
  isActive?: boolean;
};

export function SidebarMenuButton({
  className,
  isActive = false,
  render,
  ...props
}: SidebarMenuButtonProps) {
  const slotProps = {
    "data-slot": "sidebar-menu-button",
    "aria-current": isActive ? ("page" as const) : undefined,
  };

  return useRender({
    defaultTagName: "button",
    render,
    state: { active: isActive },
    props: mergeProps<"button">(
      slotProps,
      {
        className: cn(
          "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium text-sidebar-foreground outline-none transition-colors duration-100",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          "[&>span]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-sidebar-foreground/70 data-active:[&_svg]:text-sidebar-accent-foreground",
          className
        ),
      },
      props
    ),
  });
}

export function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="sidebar-footer"
      className={cn("flex shrink-0 items-center gap-2 p-3", className)}
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
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}
