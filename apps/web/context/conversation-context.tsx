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
  /** True while a reply is streaming into the active conversation. */
  isSending: boolean;
  error: string | null;
  createNewConversation: (title?: string) => Promise<Conversation>;
  sendMessage: (
    text: string,
    targetConvId?: string,
    options?: SendMessageOptions
  ) => Promise<string | undefined>;
  /** Cancels the reply streaming into the given (default: active) conversation. */
  stopGenerating: (convId?: string) => void;
  loadMore: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  selectConversation: (convId: string) => Promise<void>;
}

export interface SendMessageOptions {
  /** Called as soon as the target conversation exists, before the reply streams. */
  onConversationReady?: (conversationId: string) => void;
}

/** Messages and pagination state cached per conversation. */
interface ConversationThread {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

type ThreadMap = Readonly<Record<string, ConversationThread>>;

const EMPTY_THREAD: ConversationThread = { messages: [], hasMore: false, nextCursor: null };

const STOPPED_PLACEHOLDER = "Response stopped.";

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Returns `set` with `id` added or removed, reusing the same instance when unchanged. */
function withId(set: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  if (set.has(id) === present) return set;
  const next = new Set(set);
  if (present) next.add(id);
  else next.delete(id);
  return next;
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
  const [threads, setThreads] = React.useState<ThreadMap>({});
  const [loadingIds, setLoadingIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [streamingIds, setStreamingIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [isLoadingConversations, setIsLoadingConversations] =
    React.useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // One controller per conversation with a reply in flight. Doubles as the
  // synchronous "is streaming" check, since state updates land asynchronously.
  const streamControllersRef = React.useRef(new Map<string, AbortController>());

  const updateThread = React.useCallback(
    (convId: string, update: (thread: ConversationThread) => ConversationThread) => {
      setThreads((prev) => ({ ...prev, [convId]: update(prev[convId] ?? EMPTY_THREAD) }));
    },
    []
  );

  const updateMessage = React.useCallback(
    (convId: string, messageId: string, update: (msg: ChatMessage) => ChatMessage) => {
      updateThread(convId, (thread) => ({
        ...thread,
        messages: thread.messages.map((msg) => (msg.id === messageId ? update(msg) : msg)),
      }));
    },
    [updateThread]
  );

  // Abort any in-flight replies if the provider unmounts.
  React.useEffect(() => {
    const controllers = streamControllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  // Fetch all conversations
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
  const selectConversation = React.useCallback(
    async (convId: string) => {
      setActiveConversationId(convId);
      // A reply is streaming into this conversation; its cached thread is the
      // source of truth until the stream settles, so do not refetch over it.
      if (streamControllersRef.current.has(convId)) return;
      try {
        setLoadingIds((prev) => withId(prev, convId, true));
        setError(null);
        const res = await api.conversations.getMessages(convId, { limit: 20 });
        // A message may have been sent while this request was in flight.
        if (streamControllersRef.current.has(convId)) return;
        updateThread(convId, () => ({
          messages: res.messages,
          hasMore: res.hasMore,
          nextCursor: res.nextCursor || null,
        }));
      } catch (err: unknown) {
        console.warn("Could not load messages from API:", err);
        if (streamControllersRef.current.has(convId)) return;
        updateThread(convId, () => EMPTY_THREAD);
      } finally {
        setLoadingIds((prev) => withId(prev, convId, false));
      }
    },
    [updateThread]
  );

  const activeThread =
    (activeConversationId ? threads[activeConversationId] : undefined) ?? EMPTY_THREAD;

  // Load older messages (upward pagination)
  const loadMore = React.useCallback(async () => {
    const convId = activeConversationId;
    const cursor = activeThread.nextCursor;
    if (!convId || !activeThread.hasMore || isLoadingMore || !cursor) {
      return;
    }

    try {
      setIsLoadingMore(true);
      const res = await api.conversations.getMessages(convId, {
        limit: 20,
        beforeCursor: cursor,
      });

      updateThread(convId, (thread) => ({
        messages: [...res.messages, ...thread.messages],
        hasMore: res.hasMore,
        nextCursor: res.nextCursor || null,
      }));
    } catch (err: unknown) {
      console.error("Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeConversationId, activeThread, isLoadingMore, updateThread]);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const createNewConversation = React.useCallback(
    async (title: string = "New Chat") => {
      try {
        setError(null);
        const newConv = await api.conversations.createConversation(title);
        setConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)]);
        updateThread(newConv.id, () => EMPTY_THREAD);
        setActiveConversationId(newConv.id);
        return newConv;
      } catch (err: unknown) {
        console.error("Failed to create conversation:", err);
        throw err;
      }
    },
    [updateThread]
  );

  const stopGenerating = React.useCallback(
    (convId?: string) => {
      const targetId = convId ?? activeConversationId;
      if (!targetId) return;
      streamControllersRef.current.get(targetId)?.abort();
    },
    [activeConversationId]
  );

  const sendMessage = React.useCallback(
    async (text: string, targetConvId?: string, options?: SendMessageOptions) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      let convId = targetConvId || activeConversationId;
      // Only one reply streams into a conversation at a time.
      if (convId && streamControllersRef.current.has(convId)) return;

      if (!convId) {
        const title = trimmed.slice(0, 30) + (trimmed.length > 30 ? "..." : "");
        const newConv = await createNewConversation(title);
        convId = newConv.id;
      }

      const streamConvId = convId;
      const controller = new AbortController();
      streamControllersRef.current.set(streamConvId, controller);
      setStreamingIds((prev) => withId(prev, streamConvId, true));
      setActiveConversationId(streamConvId);

      const userMessageId = `user-${Date.now()}`;
      const assistantMessageId = `asst-${Date.now()}`;

      const userMessage: ChatMessage = {
        id: userMessageId,
        conversationId: streamConvId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      const assistantMessagePlaceholder: ChatMessage = {
        id: assistantMessageId,
        conversationId: streamConvId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };

      // Set optimistic messages immediately into the conversation's own thread,
      // so navigating elsewhere mid-stream never mixes threads.
      updateThread(streamConvId, (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage, assistantMessagePlaceholder],
      }));
      setError(null);
      options?.onConversationReady?.(streamConvId);

      try {
        const result = await api.chat.sendMessage(
          {
            conversationId: streamConvId,
            message: trimmed,
            stream: true,
            onToken: (token: string) => {
              updateMessage(streamConvId, assistantMessageId, (msg) => ({
                ...msg,
                content: msg.content + token,
              }));
            },
            onCitation: (citations) => {
              updateMessage(streamConvId, assistantMessageId, (msg) => ({ ...msg, citations }));
            },
          },
          { signal: controller.signal }
        );

        // Finalize assistant message with backend-assigned id and citations
        updateMessage(streamConvId, assistantMessageId, (msg) => ({
          ...msg,
          id: result.message?.id || msg.id,
          content: result.message?.content || msg.content,
          citations: result.citations || msg.citations,
          insufficientEvidence: result.insufficientEvidence,
        }));

        if (result.conversationId && result.conversationId !== streamConvId) {
          convId = result.conversationId;
          setActiveConversationId(convId);
        }

        // Refresh thread list to display updated conversation title
        fetchConversations();
      } catch (err: unknown) {
        if (isAbortError(err)) {
          // Stopped by the user: keep whatever streamed in so far.
          updateMessage(streamConvId, assistantMessageId, (msg) =>
            msg.content ? msg : { ...msg, content: STOPPED_PLACEHOLDER }
          );
        } else {
          console.error("Chat API stream error:", err);
          const errorMsg =
            err instanceof Error
              ? err.message
              : "An unexpected error occurred while communicating with Knowledge Engine.";
          setError(errorMsg);
          updateMessage(streamConvId, assistantMessageId, (msg) => ({
            ...msg,
            content: `⚠️ ${errorMsg}`,
          }));
        }
      } finally {
        streamControllersRef.current.delete(streamConvId);
        setStreamingIds((prev) => withId(prev, streamConvId, false));
      }

      return convId;
    },
    [activeConversationId, createNewConversation, fetchConversations, updateMessage, updateThread]
  );

  const isSending = activeConversationId !== null && streamingIds.has(activeConversationId);
  const isLoadingMessages = activeConversationId !== null && loadingIds.has(activeConversationId);

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        activeConversationId,
        setActiveConversationId,
        messages: activeThread.messages,
        hasMore: activeThread.hasMore,
        isLoadingConversations,
        isLoadingMessages,
        isLoadingMore,
        isSending,
        error,
        createNewConversation,
        sendMessage,
        stopGenerating,
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
