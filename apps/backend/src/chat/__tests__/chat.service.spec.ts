import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, MessageEvent } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { DataSource } from 'typeorm';

const getRepositoryToken = (entity: any) =>
  typeof entity === 'function' ? `${entity.name}Repository` : `${entity}Repository`;
import { ChatService } from '../services/chat.service';
import { ChatContextAssembler } from '../services/chat-context-assembler.service';
import { ConversationEntity } from '../entities/conversation.entity';
import { MessageEntity, MessageRole } from '../entities/message.entity';
import { RetrievalService } from '../../retrieval/services/retrieval.service';
import { RetrievalQueryValidator } from '../../retrieval/services/retrieval-query-validator.service';
import { LLM_PROVIDER } from '../interfaces/llm-provider.interface';
import { AppConfigService } from '../../config/app-config.service';

describe('ChatService', () => {
  let service: ChatService;
  let convRepo: any;
  let msgRepo: any;
  let retrievalService: any;
  let contextAssembler: any;
  let llmProvider: any;

  beforeEach(async () => {
    convRepo = {
      create: jest.fn((dto) => ({ id: 'conv-123', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([{ id: 'conv-123', title: 'Test Title' }]),
      findAndCount: jest.fn().mockResolvedValue([[{ id: 'conv-123', title: 'Test Title' }], 1]),
    };

    msgRepo = {
      create: jest.fn((dto) => ({ id: 'msg-456', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
    };

    retrievalService = {
      retrieveCandidates: jest.fn(),
    };

    contextAssembler = {
      assembleContext: jest.fn().mockReturnValue({
        prompt: 'SYSTEM PROMPT',
        citations: [{ chunkId: 'c1' }],
        evidenceChunkIds: ['c1'],
      }),
    };

    llmProvider = {
      generateStream: jest.fn(),
    };

    const mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === ConversationEntity) return convRepo;
        if (entity === MessageEntity) return msgRepo;
        return {};
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ChatContextAssembler, useValue: contextAssembler },
        { provide: DataSource, useValue: mockDataSource },
        { provide: RetrievalService, useValue: retrievalService },
        { provide: LLM_PROVIDER, useValue: llmProvider },
        RetrievalQueryValidator,
        {
          provide: AppConfigService,
          useValue: { chatHistoryMaxMessages: 6, chatHistoryMaxChars: 6000 },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('createConversation & getConversation', () => {
    it('should create and save a new conversation', async () => {
      const conv = await service.createConversation('user-1', 'Test Title');
      expect(convRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Test Title',
      });
      expect(conv.id).toBe('conv-123');
    });

    it('should retrieve paginated conversations', async () => {
      const result = await service.getAllConversations({ userId: 'user-1', page: 1, limit: 20 });
      expect(convRepo.findAndCount).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { updatedAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should throw NotFoundException if conversation not found', async () => {
      convRepo.findOne.mockResolvedValue(null);
      await expect(
        service.sendMessageStream({
          conversationId: 'missing-id',
          userQuery: 'hello',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendMessageStream - Fresh Chat Dynamic Session Creation', () => {
    it('should dynamically create a new conversation session when conversationId is undefined or "new"', async () => {
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [],
      });

      const observable = await service.sendMessageStream({
        userQuery: 'Fresh chat question about AWS S3',
        userId: 'user-001',
      });

      const event = await firstValueFrom(observable);
      const payload = JSON.parse(event.data as string);

      expect(convRepo.create).toHaveBeenCalledWith({
        userId: 'user-001',
        title: 'Fresh chat question about AWS S3',
      });
      expect(payload.conversationId).toBe('conv-123');
    });
  });

  describe('sendMessageStream - Evidence Found (Happy Path)', () => {
    it('should stream LLM tokens via SSE and commit assistant message entity', async () => {
      convRepo.findOne.mockResolvedValue({ id: 'conv-123' });
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [{ id: 'c1', content: 'Evidence' }],
      });

      async function* mockStream() {
        yield { token: 'Hello ', isComplete: false };
        yield { token: 'world!', isComplete: false };
        yield { token: '', isComplete: true };
      }

      llmProvider.generateStream.mockReturnValue(mockStream());

      const observable = await service.sendMessageStream({
        conversationId: 'conv-123',
        userQuery: 'How to configure Secrets Manager?',
      });

      const events: MessageEvent[] = [];
      await new Promise<void>((resolve) => {
        observable.subscribe({
          next: (evt) => events.push(evt),
          complete: () => resolve(),
        });
      });

      expect(events.length).toBeGreaterThan(0);
      expect(msgRepo.save).toHaveBeenCalled();
    });

    it('should send only a bounded tail of prior turns, without the current question', async () => {
      convRepo.findOne.mockResolvedValue({ id: 'conv-123' });
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [{ id: 'c1', content: 'Evidence' }],
      });
      /* Repository returns newest first, capped at chatHistoryMaxMessages */
      msgRepo.find.mockResolvedValue([
        { role: MessageRole.ASSISTANT, content: 'Answer 2' },
        { role: MessageRole.USER, content: 'Question 2' },
        { role: MessageRole.ASSISTANT, content: 'Answer 1' },
      ]);

      async function* mockStream() {
        yield { token: 'Done', isComplete: false };
        yield { token: '', isComplete: true };
      }
      llmProvider.generateStream.mockReturnValue(mockStream());

      const observable = await service.sendMessageStream({
        conversationId: 'conv-123',
        userQuery: 'Question 3',
      });
      await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

      expect(msgRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' }, take: 6 }),
      );
      /* Oldest first; the orphaned 'Answer 1' (its question fell outside the window) is dropped */
      expect(llmProvider.generateStream).toHaveBeenCalledWith(
        'SYSTEM PROMPT',
        [
          { role: MessageRole.USER, content: 'Question 2' },
          { role: MessageRole.ASSISTANT, content: 'Answer 2' },
        ],
        expect.any(Object),
      );
    });
  });

  describe('sendMessageStream - Insufficient Evidence Fallback', () => {
    it('should emit fallback message and set insufficientEvidence flag when candidates empty', async () => {
      convRepo.findOne.mockResolvedValue({ id: 'conv-123' });
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [],
      });

      const observable = await service.sendMessageStream({
        conversationId: 'conv-123',
        userQuery: 'Unrelated query',
      });

      const event = await firstValueFrom(observable);
      const payload = JSON.parse(event.data as string);

      expect(payload.insufficientEvidence).toBe(true);
      expect(payload.token).toContain('unable to answer your question');
      expect(llmProvider.generateStream).not.toHaveBeenCalled();
    });
  });

  describe('sendMessageStream - LLM Error / Circuit Breaker Trip', () => {
    it('should handle downstream LLM error gracefully and emit completion error payload', async () => {
      convRepo.findOne.mockResolvedValue({ id: 'conv-123' });
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [{ id: 'c1', content: 'Evidence' }],
      });

      async function* failingStream() {
        throw new Error('CircuitBreaker OPEN: LLM Provider Unavailable');
      }

      llmProvider.generateStream.mockReturnValue(failingStream());

      const observable = await service.sendMessageStream({
        conversationId: 'conv-123',
        userQuery: 'What is connection string?',
      });

      const event = await firstValueFrom(observable);
      const payload = JSON.parse(event.data as string);

      expect(payload.error).toBeDefined();
      expect(payload.isComplete).toBe(true);
    });
  });

  describe('sendMessageStream - Reranked Retrieval Integration', () => {
    it('should assemble context in reranked order and propagate reranked status to SSE and metadataJson', async () => {
      convRepo.findOne.mockResolvedValue({ id: 'conv-123' });
      retrievalService.retrieveCandidates.mockResolvedValue({
        candidates: [
          { id: 'chunk-reranked-1', content: 'Top reranked evidence', similarity: 0.98 },
          { id: 'chunk-reranked-2', content: 'Second reranked evidence', similarity: 0.85 },
        ],
        reranked: true,
        rerankFallback: false,
      });

      async function* mockStream() {
        yield { token: 'Reranked answer token', isComplete: false };
        yield { token: '', isComplete: true };
      }

      llmProvider.generateStream.mockReturnValue(mockStream());

      const observable = await service.sendMessageStream({
        conversationId: 'conv-123',
        userQuery: 'What is the reranked answer?',
        topK: 2,
      });

      const events: MessageEvent[] = [];
      await new Promise<void>((resolve) => {
        observable.subscribe({
          next: (evt) => events.push(evt),
          complete: () => resolve(),
        });
      });

      expect(retrievalService.retrieveCandidates).toHaveBeenCalledWith({
        query: 'What is the reranked answer?',
        topK: 2,
        similarityThreshold: undefined,
        traceId: undefined,
      });

      // Verify the final SSE completion event includes reranked flag and citations
      const finalEvent = events[events.length - 1];
      const payload = JSON.parse(finalEvent!.data as string);
      expect(payload.isComplete).toBe(true);
      expect(payload.reranked).toBe(true);
      expect(payload.citations).toBeDefined();

      // Verify message repository saved message with reranked metadata
      expect(msgRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataJson: expect.objectContaining({
            reranked: true,
            rerankFallback: false,
          }),
        }),
      );
    });
  });
});
