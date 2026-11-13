"use client";

import * as React from "react";
import type { ChatMessage, Conversation } from "@repo/api";
import { getApiErrorMessage } from "@repo/api";
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
  /** Set when the conversation list could not be loaded (as opposed to being empty). */
  conversationsError: string | null;
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

/** Stream key for a new chat whose conversation id the server has not reported yet. */
const PENDING_CONVERSATION_KEY = "__pending__";

/** Same rule as the backend's auto title, so the sidebar entry does not jump when it refreshes. */
function autoTitle(query: string): string {
  return query.length > 35 ? `${query.slice(0, 35)}...` : query;
}

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
  const [conversationsError, setConversationsError] = React.useState<string | null>(null);

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
      const res = await api.conversations.getConversations();
      setConversations(res);
      setConversationsError(null);
    } catch (err: unknown) {
      console.warn("Could not load conversations:", err);
      // Keep whatever list is already shown; just report that it could not be refreshed.
      setConversationsError(getApiErrorMessage(err, "Could not load conversations."));
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

      const existingConvId = targetConvId || activeConversationId || undefined;
      // A brand-new chat streams under a placeholder key until the server reports its id.
      const initialKey = existingConvId ?? PENDING_CONVERSATION_KEY;
      // Only one reply streams into a conversation at a time.
      if (streamControllersRef.current.has(initialKey)) return;

      const controller = new AbortController();
      streamControllersRef.current.set(initialKey, controller);
      setStreamingIds((prev) => withId(prev, initialKey, true));
      setError(null);

      const now = Date.now();
      const createdAt = new Date(now).toISOString();
      const userMessageId = `user-${now}`;
      const assistantMessageId = `asst-${now}`;

      let convId = existingConvId;

      // Optimistic question + empty answer, placed in the conversation's own thread so
      // navigating elsewhere mid-stream never mixes threads.
      const startThread = (id: string) => {
        updateThread(id, (thread) => ({
          ...thread,
          messages: [
            ...thread.messages,
            { id: userMessageId, conversationId: id, role: "user", content: trimmed, createdAt },
            { id: assistantMessageId, conversationId: id, role: "assistant", content: "", createdAt },
          ],
        }));
      };

      if (convId) {
        setActiveConversationId(convId);
        startThread(convId);
        options?.onConversationReady?.(convId);
      }

      try {
        const result = await api.chat.sendMessage(
          {
            // No id: the server validates the question first and only then creates the
            // conversation, so a rejected question never leaves an empty chat behind.
            conversationId: existingConvId,
            message: trimmed,
            stream: true,
            onConversationId: (id) => {
              if (convId) return;
              convId = id;
              streamControllersRef.current.delete(PENDING_CONVERSATION_KEY);
              streamControllersRef.current.set(id, controller);
              setStreamingIds((prev) => withId(withId(prev, PENDING_CONVERSATION_KEY, false), id, true));
              startThread(id);
              setActiveConversationId(id);
              setConversations((prev) =>
                prev.some((c) => c.id === id)
                  ? prev
                  : [{ id, title: autoTitle(trimmed), createdAt, updatedAt: createdAt }, ...prev]
              );
              options?.onConversationReady?.(id);
            },
            onToken: (token: string) => {
              if (!convId) return;
              updateMessage(convId, assistantMessageId, (msg) => ({
                ...msg,
                content: msg.content + token,
              }));
            },
            onCitation: (citations) => {
              if (!convId) return;
              updateMessage(convId, assistantMessageId, (msg) => ({ ...msg, citations }));
            },
          },
          { signal: controller.signal }
        );

        if (convId) {
          // Finalize assistant message with backend-assigned id and citations
          updateMessage(convId, assistantMessageId, (msg) => ({
            ...msg,
            id: result.message?.id || msg.id,
            content: result.message?.content || msg.content,
            citations: result.citations || msg.citations,
            insufficientEvidence: result.insufficientEvidence,
          }));
        }

        // Refresh thread list to display updated conversation title
        fetchConversations();
      } catch (err: unknown) {
        if (!convId) {
          // Nothing exists on the server yet: let the caller (new-chat page) show the error.
          if (isAbortError(err)) return undefined;
          throw new Error(getApiErrorMessage(err, "Could not start a conversation. Is the backend running?"));
        }
        const threadId = convId;
        if (isAbortError(err)) {
          // Stopped by the user: keep whatever streamed in so far.
          updateMessage(threadId, assistantMessageId, (msg) =>
            msg.content ? msg : { ...msg, content: STOPPED_PLACEHOLDER }
          );
        } else {
          console.error("Chat API stream error:", err);
          const errorMsg = getApiErrorMessage(
            err,
            "An unexpected error occurred while communicating with Knowledge Engine."
          );
          setError(errorMsg);
          updateMessage(threadId, assistantMessageId, (msg) => ({
            ...msg,
            content: msg.content ? `${msg.content}\n\n⚠️ ${errorMsg}` : `⚠️ ${errorMsg}`,
          }));
        }
      } finally {
        const finalKey = convId ?? PENDING_CONVERSATION_KEY;
        if (streamControllersRef.current.get(finalKey) === controller) {
          streamControllersRef.current.delete(finalKey);
        }
        setStreamingIds((prev) => withId(withId(prev, finalKey, false), PENDING_CONVERSATION_KEY, false));
      }

      return convId;
    },
    [activeConversationId, fetchConversations, updateMessage, updateThread]
  );

  // On the new-chat page (no active conversation) the pending stream counts as sending.
  const isSending = streamingIds.has(activeConversationId ?? PENDING_CONVERSATION_KEY);
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
        conversationsError,
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
