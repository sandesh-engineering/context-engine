import { GeminiLlmProvider } from '../providers/gemini-llm.provider';
import { AppConfigService } from '../../config/app-config.service';
import { CircuitBreaker } from '../../ingestion/resilience/circuit-breaker';
import { RetryPolicy } from '../../ingestion/resilience/retry-policy';

describe('GeminiLlmProvider', () => {
  let mockConfig: Partial<AppConfigService>;
  let mockGenAiClient: any;
  let mockModels: any;
  let mockChats: any;
  let mockChatSession: any;

  beforeEach(() => {
    mockConfig = {
      geminiApiKey: 'test-gemini-key',
      geminiChatModel: 'gemini-2.5-flash',
      circuitBreakerFailureThreshold: 3,
      circuitBreakerResetTimeoutMs: 10000,
    };

    async function* mockStreamGenerator() {
      yield { text: () => 'Hello ' };
      yield { text: () => 'from ' };
      yield { text: () => 'Gemini!' };
    }

    mockModels = {
      generateContentStream: jest.fn().mockImplementation(async () => mockStreamGenerator()),
    };

    mockChatSession = {
      sendMessageStream: jest.fn().mockImplementation(async () => mockStreamGenerator()),
    };

    mockChats = {
      create: jest.fn().mockReturnValue(mockChatSession),
    };

    mockGenAiClient = {
      models: mockModels,
      chats: mockChats,
    };
  });

  it('should stream tokens using models.generateContentStream when no history is provided', async () => {
    const provider = new GeminiLlmProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const chunks: string[] = [];
    let isCompleteFinal = false;

    for await (const chunk of provider.generateStream('Summarize this doc')) {
      if (chunk.token) {
        chunks.push(chunk.token);
      }
      if (chunk.isComplete) {
        isCompleteFinal = true;
      }
    }

    expect(mockModels.generateContentStream).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      contents: ['Summarize this doc'],
      config: {
        temperature: 0.2,
      },
    });
    expect(chunks.join('')).toBe('Hello from Gemini!');
    expect(isCompleteFinal).toBe(true);
  });

  it('should create a stateful chat session when conversation history is provided', async () => {
    const provider = new GeminiLlmProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const history = [
      { role: 'USER' as const, content: 'Hi there' },
      { role: 'ASSISTANT' as const, content: 'Hello, how can I help?' },
    ];

    const chunks: string[] = [];
    for await (const chunk of provider.generateStream('What is AWS S3?', history)) {
      if (chunk.token) {
        chunks.push(chunk.token);
      }
    }

    expect(mockChats.create).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      history: [
        { role: 'user', parts: [{ text: 'Hi there' }] },
        { role: 'model', parts: [{ text: 'Hello, how can I help?' }] },
      ],
      config: {
        temperature: 0.2,
      },
    });
    expect(mockChatSession.sendMessageStream).toHaveBeenCalledWith({
      message: 'What is AWS S3?',
    });
    expect(chunks.join('')).toBe('Hello from Gemini!');
  });

  it('should pass system instructions into config when history contains SYSTEM role', async () => {
    const provider = new GeminiLlmProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const history = [
      { role: 'SYSTEM' as const, content: 'You are an internal helper' },
      { role: 'USER' as const, content: 'Help me' },
    ];

    for await (const _chunk of provider.generateStream('Question', history)) {
      // consume
    }

    expect(mockChats.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          systemInstruction: 'You are an internal helper',
        }),
      }),
    );
  });

  it('should abort stream when signal is aborted during generation', async () => {
    const provider = new GeminiLlmProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const controller = new AbortController();

    async function* slowStream() {
      yield { text: () => 'First token' };
      controller.abort();
      yield { text: () => 'Second token' };
    }

    mockModels.generateContentStream.mockImplementation(async () => slowStream());

    const chunks: string[] = [];
    for await (const chunk of provider.generateStream('Prompt', [], { signal: controller.signal })) {
      if (chunk.token) {
        chunks.push(chunk.token);
      }
    }

    expect(chunks).toContain('First token');
    expect(chunks).not.toContain('Second token');
  });

  it('should retry on transient failure and trip circuit breaker on repeated errors', async () => {
    const breaker = new CircuitBreaker({
      name: 'TestGeminiBreaker',
      failureThreshold: 2,
      resetTimeoutMs: 5000,
    });
    const retryPolicy = new RetryPolicy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    const transientErr = new Error('Connection timeout to Gemini API');
    (transientErr as any).code = 'ETIMEDOUT';
    mockModels.generateContentStream.mockRejectedValue(transientErr);

    const provider = new GeminiLlmProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
      circuitBreaker: breaker,
      retryPolicy,
    });

    // First failed call
    await expect(async () => {
      for await (const _chunk of provider.generateStream('Prompt 1')) {
        // consume
      }
    }).rejects.toThrow('Connection timeout to Gemini API');

    // Second failed call trips the breaker
    await expect(async () => {
      for await (const _chunk of provider.generateStream('Prompt 2')) {
        // consume
      }
    }).rejects.toThrow('Connection timeout to Gemini API');

    expect(breaker.getState()).toBe('OPEN');
  });
});
