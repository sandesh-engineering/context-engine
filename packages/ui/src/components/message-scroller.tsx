"use client";

import * as React from "react";
import { ArrowDownIcon, Loader2Icon } from "lucide-react";
import { cn } from "../lib/utils";

export interface MessageScrollerProps {
  children: React.ReactNode;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

export function MessageScroller({
  children,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  className,
}: MessageScrollerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const topSentinelRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = React.useState(false);
  const prevScrollHeightRef = React.useRef<number>(0);
  const isAutoScrollingRef = React.useRef<boolean>(true);

  // Set up IntersectionObserver for top sentinel
  React.useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;

    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          const container = containerRef.current;
          if (container) {
            prevScrollHeightRef.current = container.scrollHeight;
          }
          onLoadMore();
        }
      },
      {
        root: containerRef.current,
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Adjust scroll position after prepending older messages
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (prevScrollHeightRef.current > 0) {
      const newScrollHeight = container.scrollHeight;
      const heightDifference = newScrollHeight - prevScrollHeightRef.current;
      if (heightDifference > 0) {
        container.scrollTop += heightDifference;
      }
      prevScrollHeightRef.current = 0;
    }
  });

  // Track scroll position to show/hide scroll-to-bottom button
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    isAutoScrollingRef.current = distanceFromBottom < 80;
    setShowScrollBottom(distanceFromBottom > 150);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  };

  return (
    <div className="relative flex h-full w-full flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        data-slot="message-scroller"
        role="log"
        aria-live="polite"
        className={cn(
          "flex h-full w-full flex-col overflow-y-auto px-4 py-4 scroll-smooth",
          className
        )}
      >
        {/* Top Sentinel for on-demand loading */}
        <div ref={topSentinelRef} className="h-1 w-full shrink-0" />

        {isLoadingMore && (
          <div className="flex w-full items-center justify-center py-2 text-muted-foreground text-xs gap-2">
            <Loader2Icon className="size-3.5 animate-spin" />
            <span>Loading previous messages...</span>
          </div>
        )}

        {/* Message stream */}
        <div className="flex flex-col gap-2">{children}</div>

        {/* Bottom Anchor */}
        <div ref={bottomRef} className="h-1 w-full shrink-0" />
      </div>

      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          aria-label="Scroll to latest messages"
          className="absolute bottom-4 right-6 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
