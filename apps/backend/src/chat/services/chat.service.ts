import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { ConversationEntity } from '../entities/conversation.entity';
import { MessageEntity, MessageRole } from '../entities/message.entity';
import { GetConversationsDto, PaginatedConversationsResponse } from '../dto';
import { RetrievalService } from '../../retrieval/services/retrieval.service';
import { ChatContextAssembler } from './chat-context-assembler.service';
import type { ILlmProvider, MessageHistory } from '../interfaces/llm-provider.interface';
import { LLM_PROVIDER } from '../interfaces/llm-provider.interface';
import { AppTracer, SemanticAttributes } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

import { CitationMetadata } from '../entities/message.entity';

export interface SendMessageParams {
  conversationId?: string;
  userQuery: string;
  userId?: string;
  title?: string;
  topK?: number;
  similarityThreshold?: number;
  signal?: AbortSignal;
  traceId?: string;
}

export interface StreamEventPayload {
  token: string;
  isComplete: boolean;
  conversationId?: string;
  messageId?: string;
  insufficientEvidence?: boolean;
  citations?: CitationMetadata[];
  reranked?: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new StructuredLogger(ChatService.name);
  private readonly conversationRepository: Repository<ConversationEntity>;
  private readonly messageRepository: Repository<MessageEntity>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly retrievalService: RetrievalService,
    private readonly contextAssembler: ChatContextAssembler,
    @Inject(LLM_PROVIDER)
    private readonly llmProvider: ILlmProvider,
    @Optional() convRepo?: Repository<ConversationEntity>,
    @Optional() msgRepo?: Repository<MessageEntity>,
  ) {
    this.conversationRepository =
      convRepo || (this.dataSource ? this.dataSource.getRepository(ConversationEntity) : ({} as any));
    this.messageRepository =
      msgRepo || (this.dataSource ? this.dataSource.getRepository(MessageEntity) : ({} as any));
  }

  /**
   * Creates a new chat conversation session.
   */
  async createConversation(
    userId?: string,
    title?: string,
  ): Promise<ConversationEntity> {
    this.logger.logEvent(LogEvents.CHAT_SESSION_CREATED, { userId, title });
    const conversation = this.conversationRepository.create({
      userId,
      title: title || 'New Conversation',
    });
    return this.conversationRepository.save(conversation);
  }

  /**
   * Retrieves paginated conversation sessions, optionally filtered by user ID.
   */
  async getAllConversations(
    query?: GetConversationsDto | string,
    pageParam?: number,
    limitParam?: number,
  ): Promise<PaginatedConversationsResponse<ConversationEntity>> {
    let userId: string | undefined;
    let page = 1;
    let limit = 20;

    if (typeof query === 'string') {
      userId = query;
      page = pageParam ?? 1;
      limit = limitParam ?? 20;
    } else if (query) {
      userId = query.userId;
      page = query.page ?? 1;
      limit = query.limit ?? 20;
    }

    const where = userId ? { userId } : {};
    const [items, total] = await this.conversationRepository.findAndCount({
      where,
      order: {
        updatedAt: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Retrieves conversation entity with sequential message history.
   */
  async getConversation(
    conversationId: string,
  ): Promise<ConversationEntity> {
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
      this.logger.warnEvent('chat.conversation.not_found', { conversationId });
      throw new NotFoundException(
        `Conversation with ID '${conversationId}' was not found.`,
      );
    }

    return conversation;
  }

  private isUuid(id?: string): boolean {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  /**
   * Retrieves all sequential message turns for a conversation session.
   */
  async getConversationMessages(
    conversationId: string,
  ): Promise<MessageEntity[]> {
    const conversation = await this.getConversation(conversationId);
    return this.messageRepository.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Orchestrates multi-turn RAG chat message stream inside an active trace span.
   */
  async sendMessageStream(
    params: SendMessageParams,
  ): Promise<Observable<MessageEvent>> {
    let conversation: ConversationEntity | null = null;

    if (params.conversationId && params.conversationId !== 'new') {
      conversation = await this.conversationRepository.findOne({
        where: { id: params.conversationId },
      });

      if (!conversation) {
        this.logger.warnEvent('chat.conversation.not_found', {
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

      this.logger.logEvent(LogEvents.CHAT_SESSION_CREATED, {
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

    /* Execute retrieval and streaming asynchronously inside root trace span */
    AppTracer.traceSpan(
      'chat.request',
      {
        attributes: {
          'conversation.id': conversation.id,
          'user.query_length': params.userQuery.length,
          [SemanticAttributes.KE_TENANT_ID]: params.userId || 'default',
        },
      },
      async (span) => {
        this.logger.logEvent(LogEvents.CHAT_REQUEST_STARTED, {
          conversationId: conversation!.id,
          userQueryLength: params.userQuery.length,
          traceId: params.traceId,
        });

        try {
          await this.processStream(params, conversation!, subject);
          span.setAttribute('chat.completed', true);
          this.logger.logEvent(LogEvents.CHAT_REQUEST_COMPLETED, {
            conversationId: conversation!.id,
            traceId: params.traceId,
          });
        } catch (err: any) {
          this.logger.logError(LogEvents.CHAT_REQUEST_FAILED, err, {
            conversationId: conversation!.id,
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
          throw err;
        }
      },
    ).catch(() => {
      // Span error already recorded and handled in stream subject
    });

    return subject.asObservable();
  }

  /**
   * Internal asynchronous process executing retrieval, context assembly, and streaming.
   */
  private async processStream(
    params: SendMessageParams,
    conversation: ConversationEntity,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    /* Step 2: Trigger candidate retrieval (with cross-encoder reranking if enabled) */
    const retrievalResult = await this.retrievalService.retrieveCandidates({
      query: params.userQuery,
      topK: params.topK,
      similarityThreshold: params.similarityThreshold,
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
        metadataJson: {
          traceId: params.traceId,
          reranked: retrievalResult.reranked ?? false,
          rerankFallback: retrievalResult.rerankFallback ?? false,
        },
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
          reranked: retrievalResult.reranked ?? false,
        } as StreamEventPayload),
      } as MessageEvent);

      subject.complete();
      return;
    }

    /* Step 4: Assemble prompt context (sub-span: chat.context_build) */
    const assembledContext = await AppTracer.traceSpan(
      'chat.context_build',
      {
        attributes: {
          'candidate.count': retrievalResult.candidates.length,
          [SemanticAttributes.RAG_RERANK_ENABLED]: retrievalResult.reranked ?? false,
        },
      },
      async () => {
        const result = this.contextAssembler.assembleContext(
          params.userQuery,
          retrievalResult.candidates,
        );

        this.logger.debugEvent(LogEvents.CHAT_CONTEXT_ASSEMBLED, {
          conversationId: conversation.id,
          evidenceChunkCount: result.evidenceChunkIds.length,
          citationCount: result.citations.length,
          reranked: retrievalResult.reranked ?? false,
        });

        return result;
      },
    );

    const existingMessages = await this.messageRepository.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    const history: MessageHistory[] = existingMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    /* Step 5: Delegate streaming generation to LLM Provider (sub-span: chat.llm_generation) */
    let accumulatedContent = '';
    let isAborted = false;
    let finalContextState: number[] | undefined;
    let finalProviderSessionId: string | undefined;

    await AppTracer.traceSpan(
      'chat.llm_generation',
      {
        attributes: {
          'conversation.id': conversation.id,
          'history.message_count': history.length,
        },
      },
      async (llmSpan) => {
        this.logger.logEvent(LogEvents.CHAT_LLM_STREAM_STARTED, {
          conversationId: conversation.id,
        });

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

          let tokenCount = 0;
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
              tokenCount++;
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

          llmSpan.setAttribute('llm.tokens_emitted', tokenCount);
          llmSpan.setAttribute('llm.aborted', isAborted);

          this.logger.logEvent(LogEvents.CHAT_LLM_COMPLETED, {
            conversationId: conversation.id,
            tokensEmitted: tokenCount,
            aborted: isAborted,
          });

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
              reranked: retrievalResult.reranked ?? false,
              rerankFallback: retrievalResult.rerankFallback ?? false,
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
              citations: assembledContext.citations,
              reranked: retrievalResult.reranked ?? false,
            } as StreamEventPayload),
          } as MessageEvent);
        } catch (llmError) {
          this.logger.logError('chat.llm.failed', llmError, {
            conversationId: conversation.id,
          });
          subject.next({
            data: JSON.stringify({
              error: 'LLM provider failed to generate response.',
              conversationId: conversation.id,
              isComplete: true,
            }),
          } as MessageEvent);
          throw llmError;
        } finally {
          subject.complete();
        }
      },
    );
  }
}
