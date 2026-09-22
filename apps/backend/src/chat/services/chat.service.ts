import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { ConversationEntity } from '../entities/conversation.entity';
import { MessageEntity, MessageRole } from '../entities/message.entity';
import { RetrievalService } from '../../retrieval/services/retrieval.service';
import { ChatContextAssembler } from './chat-context-assembler.service';
import type { ILlmProvider, MessageHistory } from '../interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../interfaces/llm-provider.interface';

export interface SendMessageParams {
  conversationId?: string;
  userQuery: string;
  userId?: string;
  title?: string;
  signal?: AbortSignal;
  traceId?: string;
}

export interface StreamEventPayload {
  token: string;
  isComplete: boolean;
  conversationId?: string;
  messageId?: string;
  insufficientEvidence?: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    private readonly retrievalService: RetrievalService,
    private readonly contextAssembler: ChatContextAssembler,
    @Inject(LLM_PROVIDER)
    private readonly llmProvider: ILlmProvider,
  ) { }

  /**
   * Creates a new chat conversation session.
   *
   * @param {string} [userId] - Optional tenant/user identifier
   * @param {string} [title] - Optional conversation title
   * @returns {Promise<ConversationEntity>} Saved conversation entity
   */
  async createConversation(
    userId?: string,
    title?: string,
  ): Promise<ConversationEntity> {
    this.logger.log('Creating new conversation session', { userId, title });
    const conversation = this.conversationRepository.create({
      userId,
      title: title || 'New Conversation',
    });
    const saved = await this.conversationRepository.save(conversation);
    this.logger.log('Conversation session created successfully', {
      conversationId: saved.id,
    });
    return saved;
  }

  /**
   * Retrieves all conversation sessions, optionally filtered by user ID.
   *
   * @param {string} [userId] - Optional tenant/user identifier
   * @returns {Promise<ConversationEntity[]>} List of conversation sessions ordered by latest activity
   */
  async getAllConversations(userId?: string): Promise<ConversationEntity[]> {
    this.logger.log('Fetching list of conversations', { userId });
    const where = userId ? { userId } : {};
    return this.conversationRepository.find({
      where,
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  /**
   * Retrieves conversation entity with sequential message history.
   *
   * @param {string} conversationId - Conversation UUID
   * @returns {Promise<ConversationEntity>} Conversation entity with messages
   * @throws {NotFoundException} Throws if conversation ID is not found
   */
  async getConversation(
    conversationId: string,
  ): Promise<ConversationEntity> {
    this.logger.log('Fetching conversation details with message history', {
      conversationId,
    });

    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['messages'],
      order: {
        messages: {
          createdAt: 'ASC',
        },
      },
    });

    if (!conversation) {
      this.logger.warn('Conversation not found', { conversationId });
      throw new NotFoundException(
        `Conversation with ID '${conversationId}' was not found.`,
      );
    }

    return conversation;
  }

  /**
   * Helper to validate if a string is a valid UUID v4 format.
   */
  private isUuid(id?: string): boolean {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  /**
   * Retrieves all sequential message turns for a conversation session.
   *
   * @param {string} conversationId - Conversation UUID
   * @returns {Promise<MessageEntity[]>} List of message entities ordered chronologically
   */
  async getConversationMessages(
    conversationId: string,
  ): Promise<MessageEntity[]> {
    this.logger.log('Fetching conversation messages', { conversationId });
    const conversation = await this.getConversation(conversationId);
    return this.messageRepository.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Orchestrates multi-turn RAG chat message stream:
   * 1. Validates UUID or dynamically creates a new session for fresh chats
   * 2. Validates and saves incoming USER message turn
   * 3. Triggers vector candidate retrieval
   * 4. Handles insufficient evidence fallback (if zero candidates match threshold)
   * 5. Assembles prompt with injection guardrails and fetches conversation history
   * 6. Streams tokens via SSE Observable, updates provider session state, and commits ASSISTANT turn to DB
   *
   * @param {SendMessageParams} params - Conversation ID (optional/new), query text, signal, trace context
   * @returns {Promise<Observable<MessageEvent>>} RxJS Observable of SSE MessageEvents
   */
  async sendMessageStream(
    params: SendMessageParams,
  ): Promise<Observable<MessageEvent>> {
    let conversation: ConversationEntity | null = null;

    if (params.conversationId && this.isUuid(params.conversationId)) {
      conversation = await this.conversationRepository.findOne({
        where: { id: params.conversationId },
      });

      if (!conversation) {
        this.logger.warn('Conversation not found for message stream', {
          conversationId: params.conversationId,
        });
        throw new NotFoundException(
          `Conversation with ID '${params.conversationId}' was not found.`,
        );
      }
    } else {
      /* Handle fresh chat session creation dynamically */
      const autoTitle =
        params.title ||
        (params.userQuery.length > 35
          ? `${params.userQuery.slice(0, 35)}...`
          : params.userQuery);

      this.logger.log('Creating dynamic conversation session for fresh chat', {
        userId: params.userId,
        title: autoTitle,
      });

      conversation = await this.createConversation(params.userId, autoTitle);
    }

    /* Step 1: Persist incoming USER message turn */
    const userMessage = this.messageRepository.create({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content: params.userQuery,
      metadataJson: { traceId: params.traceId },
    });
    await this.messageRepository.save(userMessage);

    const subject = new Subject<MessageEvent>();

    /* Execute retrieval and streaming asynchronously */
    this.processStream(params, conversation, subject).catch((err) => {
      this.logger.error('Unhandled exception during chat response streaming', {
        conversationId: conversation!.id,
        error: err instanceof Error ? err.message : String(err),
        traceId: params.traceId,
      });
      subject.next({
        data: JSON.stringify({
          error: 'An internal error occurred while processing your request.',
          conversationId: conversation!.id,
          isComplete: true,
        }),
      } as MessageEvent);
      subject.complete();
    });

    return subject.asObservable();
  }

  /**
   * Internal asynchronous process executing retrieval, streaming, and DB persistence.
   */
  private async processStream(
    params: SendMessageParams,
    conversation: ConversationEntity,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    /* Step 2: Trigger vector similarity search */
    const retrievalResult = await this.retrievalService.retrieveCandidates({
      query: params.userQuery,
      traceId: params.traceId,
    });

    /* Step 3: Handle insufficient evidence fail-fast */
    if (retrievalResult.candidates.length === 0) {
      const fallbackContent =
        'I am unable to answer your question because the relevant internal documentation could not be found.';

      const fallbackAssistantMsg = this.messageRepository.create({
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: fallbackContent,
        insufficientEvidence: true,
        metadataJson: { traceId: params.traceId },
      });

      const savedFallbackMsg = await this.messageRepository.save(
        fallbackAssistantMsg,
      );

      subject.next({
        data: JSON.stringify({
          token: fallbackContent,
          isComplete: true,
          conversationId: conversation.id,
          messageId: savedFallbackMsg.id,
          insufficientEvidence: true,
        } as StreamEventPayload),
      } as MessageEvent);

      subject.complete();
      return;
    }

    /* Step 4: Assemble prompt context and fetch prior message history */
    const assembledContext = this.contextAssembler.assembleContext(
      params.userQuery,
      retrievalResult.candidates,
    );

    const existingMessages = await this.messageRepository.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    const history: MessageHistory[] = existingMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    /* Step 5: Delegate streaming generation to LLM Provider passing session/context state */
    let accumulatedContent = '';
    let isAborted = false;
    let finalContextState: number[] | undefined;
    let finalProviderSessionId: string | undefined;

    try {
      const stream = this.llmProvider.generateStream(
        assembledContext.prompt,
        history,
        {
          signal: params.signal,
          providerSessionId: conversation.providerSessionId,
          contextState: conversation.contextState,
        },
      );

      for await (const chunk of stream) {
        if (params.signal?.aborted) {
          isAborted = true;
          break;
        }

        if (chunk.contextState) {
          finalContextState = chunk.contextState;
        }
        if (chunk.providerSessionId) {
          finalProviderSessionId = chunk.providerSessionId;
        }

        if (chunk.token) {
          accumulatedContent += chunk.token;
          subject.next({
            data: JSON.stringify({
              token: chunk.token,
              isComplete: false,
              conversationId: conversation.id,
            } as StreamEventPayload),
          } as MessageEvent);
        }

        if (chunk.isComplete) {
          break;
        }
      }

      /* Update conversation with LLM provider session ID or token context state */
      if (finalContextState || finalProviderSessionId) {
        await this.conversationRepository.update(conversation.id, {
          ...(finalProviderSessionId ? { providerSessionId: finalProviderSessionId } : {}),
          ...(finalContextState ? { contextState: finalContextState } : {}),
        });
      }

      /* Step 6: Commit complete ASSISTANT message turn to database */
      const assistantMessage = this.messageRepository.create({
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: accumulatedContent,
        evidenceChunkIds: assembledContext.evidenceChunkIds,
        citations: assembledContext.citations,
        insufficientEvidence: false,
        metadataJson: {
          traceId: params.traceId,
          aborted: isAborted,
        },
      });

      const savedAssistantMsg = await this.messageRepository.save(
        assistantMessage,
      );

      subject.next({
        data: JSON.stringify({
          token: '',
          isComplete: true,
          conversationId: conversation.id,
          messageId: savedAssistantMsg.id,
          insufficientEvidence: false,
        } as StreamEventPayload),
      } as MessageEvent);
    } catch (llmError) {
      this.logger.error('LLM provider stream error', {
        conversationId: conversation.id,
        error: llmError instanceof Error ? llmError.message : String(llmError),
      });
      subject.next({
        data: JSON.stringify({
          error: 'LLM provider failed to generate response.',
          conversationId: conversation.id,
          isComplete: true,
        }),
      } as MessageEvent);
      subject.complete();
    } finally {
      subject.complete();
    }
  }
}
