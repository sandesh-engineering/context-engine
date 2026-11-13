import { selectHistoryWindow } from '../utils/history-window';
import type { MessageHistory } from '../interfaces/llm-provider.interface';

const turn = (role: MessageHistory['role'], content: string): MessageHistory => ({ role, content });

describe('selectHistoryWindow', () => {
  const conversation = [
    turn('USER', 'q1'),
    turn('ASSISTANT', 'a1'),
    turn('USER', 'q2'),
    turn('ASSISTANT', 'a2'),
  ];

  it('returns the whole conversation when it fits', () => {
    expect(selectHistoryWindow(conversation, { maxMessages: 10, maxChars: 1000 })).toEqual(
      conversation,
    );
  });

  it('keeps only the newest messages up to the message limit', () => {
    expect(selectHistoryWindow(conversation, { maxMessages: 2, maxChars: 1000 })).toEqual([
      turn('USER', 'q2'),
      turn('ASSISTANT', 'a2'),
    ]);
  });

  it('stops at the first message that would exceed the character budget', () => {
    const long = [turn('USER', 'x'.repeat(50)), turn('ASSISTANT', 'short'), turn('USER', 'next')];
    /* 'next' + 'short' fit in 10 chars; the 50-char question does not, which orphans 'short' */
    expect(selectHistoryWindow(long, { maxMessages: 10, maxChars: 10 })).toEqual([turn('USER', 'next')]);
  });

  it('drops an assistant reply whose question fell outside the window', () => {
    expect(selectHistoryWindow(conversation, { maxMessages: 3, maxChars: 1000 })).toEqual([
      turn('USER', 'q2'),
      turn('ASSISTANT', 'a2'),
    ]);
  });

  it('returns nothing when the limits are zero', () => {
    expect(selectHistoryWindow(conversation, { maxMessages: 0, maxChars: 1000 })).toEqual([]);
    expect(selectHistoryWindow(conversation, { maxMessages: 10, maxChars: 0 })).toEqual([]);
  });
});
