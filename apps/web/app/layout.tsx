import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@repo/ui/lib/utils";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { ConversationProvider } from "../context/conversation-context";
import { AppSidebar } from "../components/app-sidebar";
import { AppHeader } from "../components/app-header";
import { themeInitScript } from "../lib/theme";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Knowledge Engine | Enterprise RAG & Ingestion",
  description:
    "Interactive LLM chat and document ingestion system with on-demand message pagination.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("font-sans antialiased", geist.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground selection:bg-primary/15">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>

        <ConversationProvider>
          <TooltipProvider>
            <SidebarProvider defaultExpanded={true}>
              <AppSidebar />
              <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
                <AppHeader />
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="flex min-h-0 flex-1 flex-col overflow-hidden focus:outline-none"
                >
                  {children}
                </main>
              </div>
            </SidebarProvider>
          </TooltipProvider>
        </ConversationProvider>
      </body>
    </html>
  );
}
