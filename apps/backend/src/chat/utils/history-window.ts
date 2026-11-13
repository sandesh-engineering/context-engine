import type { MessageHistory } from '../interfaces/llm-provider.interface';

export interface HistoryWindowLimits {
  maxMessages: number;
  maxChars: number;
}

/**
 * Keeps the newest messages that fit both limits, returned oldest first.
 *
 * @remarks
 * Walks back from the newest message and stops at the first one that would break a limit, so the
 * window is always a contiguous tail of the conversation. If the window would open on an ASSISTANT
 * reply, that reply is dropped too: a reply without its question only confuses the model.
 *
 * @param {MessageHistory[]} messages - Prior turns, oldest first, without the current question
 * @param {HistoryWindowLimits} limits - Maximum message count and total characters
 * @returns {MessageHistory[]} The bounded tail of the conversation, oldest first
 */
export function selectHistoryWindow(
  messages: MessageHistory[],
  limits: HistoryWindowLimits,
): MessageHistory[] {
  const window: MessageHistory[] = [];
  let usedChars = 0;

  for (let i = messages.length - 1; i >= 0 && window.length < limits.maxMessages; i--) {
    const message = messages[i]!;
    if (usedChars + message.content.length > limits.maxChars) {
      break;
    }
    usedChars += message.content.length;
    window.unshift(message);
  }

  if (window[0]?.role === 'ASSISTANT') {
    window.shift();
  }

  return window;
}
