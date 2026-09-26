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
import { LLM_PROVIDER } from '../interfaces/llm-provider.interface';

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

    it('should retrieve all conversations', async () => {
      const convs = await service.getAllConversations('user-1');
      expect(convRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { updatedAt: 'DESC' },
      });
      expect(convs).toHaveLength(1);
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
      expect(payload.token).toContain('insufficient evidence');
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
});
