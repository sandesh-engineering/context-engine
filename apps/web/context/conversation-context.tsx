"use client";

import * as React from "react";
import type { ChatMessage, Conversation } from "@repo/api";
import { api } from "../lib/api-client";

interface ConversationContextType {
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  messages: ChatMessage[];
  hasMore: boolean;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isLoadingMore: boolean;
  isSending: boolean;
  error: string | null;
  createNewConversation: (title?: string) => Promise<Conversation>;
  sendMessage: (text: string, targetConvId?: string) => Promise<string | undefined>;
  loadMore: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  selectConversation: (convId: string) => Promise<void>;
}

const ConversationContext = React.createContext<
  ConversationContextType | undefined
>(undefined);

export function ConversationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<
    string | null
  >(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = React.useState<boolean>(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] =
    React.useState<boolean>(true);
  const [isLoadingMessages, setIsLoadingMessages] =
    React.useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState<boolean>(false);
  const [isSending, setIsSending] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // Track conversation currently being seeded optimistically
  const optimisticConvIdRef = React.useRef<string | null>(null);

  // Fetch all conversations for tenant
  const fetchConversations = React.useCallback(async () => {
    try {
      setIsLoadingConversations(true);
      setError(null);
      const res = await api.conversations.getConversations();
      setConversations(res);
    } catch (err: unknown) {
      console.warn("Could not reach backend conversations API, using offline fallback:", err);
      setConversations([]);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  // Explicitly select and load messages for a conversation
  const selectConversation = React.useCallback(async (convId: string) => {
    setActiveConversationId(convId);
    try {
      setIsLoadingMessages(true);
      setError(null);
      const res = await api.conversations.getMessages(convId, { limit: 20 });
      setMessages(res.messages);
      setHasMore(res.hasMore);
      setNextCursor(res.nextCursor || null);
    } catch (err: unknown) {
      console.warn("Could not load messages from API:", err);
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Load older messages (upward pagination)
  const loadMore = React.useCallback(async () => {
    if (!activeConversationId || !hasMore || isLoadingMore || !nextCursor) {
      return;
    }

    try {
      setIsLoadingMore(true);
      const res = await api.conversations.getMessages(activeConversationId, {
        limit: 20,
        beforeCursor: nextCursor,
      });

      setMessages((prev) => [...res.messages, ...prev]);
      setHasMore(res.hasMore);
      setNextCursor(res.nextCursor || null);
    } catch (err: unknown) {
      console.error("Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeConversationId, hasMore, isLoadingMore, nextCursor]);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const createNewConversation = React.useCallback(
    async (title: string = "New Chat") => {
      try {
        setError(null);
        const newConv = await api.conversations.createConversation(title);
        setConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)]);
        setActiveConversationId(newConv.id);
        setMessages([]);
        setHasMore(false);
        setNextCursor(null);
        return newConv;
      } catch (err: unknown) {
        console.error("Failed to create conversation:", err);
        throw err;
      }
    },
    []
  );

  const sendMessage = React.useCallback(
    async (text: string, targetConvId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      let convId = targetConvId || activeConversationId;
      let isNewlyCreated = false;

      if (!convId) {
        const title = trimmed.slice(0, 30) + (trimmed.length > 30 ? "..." : "");
        const newConv = await createNewConversation(title);
        convId = newConv.id;
        isNewlyCreated = true;
      }

      optimisticConvIdRef.current = convId;
      setActiveConversationId(convId);

      const userMessageId = `user-${Date.now()}`;
      const assistantMessageId = `asst-${Date.now()}`;

      const userMessage: ChatMessage = {
        id: userMessageId,
        conversationId: convId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      const assistantMessagePlaceholder: ChatMessage = {
        id: assistantMessageId,
        conversationId: convId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };

      // Set optimistic messages immediately into state
      setMessages((prev) =>
        isNewlyCreated
          ? [userMessage, assistantMessagePlaceholder]
          : [...prev, userMessage, assistantMessagePlaceholder]
      );
      setIsSending(true);
      setError(null);

      try {
        const result = await api.chat.sendMessage({
          conversationId: convId,
          message: trimmed,
          stream: true,
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: msg.content + token }
                  : msg
              )
            );
          },
          onCitation: (citations) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, citations }
                  : msg
              )
            );
          },
        });

        // Finalize assistant message with backend-assigned id and citations
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  id: result.message?.id || msg.id,
                  content: result.message?.content || msg.content,
                  citations: result.citations || msg.citations,
                  insufficientEvidence: result.insufficientEvidence,
                }
              : msg
          )
        );

        if (result.conversationId && result.conversationId !== convId) {
          convId = result.conversationId;
          setActiveConversationId(convId);
        }

        // Refresh thread list to display updated conversation title
        fetchConversations();
      } catch (err: unknown) {
        console.error("Chat API stream error:", err);
        const errorMsg =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while communicating with Knowledge Engine.";
        setError(errorMsg);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `⚠️ ${errorMsg}`,
                }
              : msg
          )
        );
      } finally {
        setIsSending(false);
        optimisticConvIdRef.current = null;
      }

      return convId;
    },
    [activeConversationId, createNewConversation, fetchConversations, isSending]
  );

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        activeConversationId,
        setActiveConversationId,
        messages,
        hasMore,
        isLoadingConversations,
        isLoadingMessages,
        isLoadingMore,
        isSending,
        error,
        createNewConversation,
        sendMessage,
        loadMore,
        refreshConversations: fetchConversations,
        selectConversation,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversation() {
  const context = React.useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "useConversation must be used within a ConversationProvider"
    );
  }
  return context;
}
