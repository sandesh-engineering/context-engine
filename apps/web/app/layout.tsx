import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@repo/ui/lib/utils";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { ConversationProvider } from "../context/conversation-context";
import { AppSidebar } from "../components/app-sidebar";
import { AppHeader } from "../components/app-header";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
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
    <html lang="en" className={cn("font-sans antialiased", geist.variable)}>
      <body
        className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 font-sans"
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>

        <ConversationProvider>
          <SidebarProvider defaultExpanded={true}>
            <div className="flex min-h-screen w-full bg-background">
              <AppSidebar />
              <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                <AppHeader />
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="flex flex-1 flex-col overflow-hidden focus:outline-none"
                >
                  {children}
                </main>
              </div>
            </div>
          </SidebarProvider>
        </ConversationProvider>
      </body>
    </html>
  );
}
