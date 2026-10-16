import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Sse,
  Req,
  HttpStatus,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { type Request } from 'express';
import { Observable } from 'rxjs';
import { ChatService } from './services/chat.service';
import { CreateConversationDto, SendMessageDto } from './dto';

@ApiTags('Conversations')
@Controller('conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Creates a new chat conversation session.
   */
  @Post()
  @ApiOperation({
    summary: 'Create conversation session',
    description: 'Initializes a new stateful multi-turn conversation session',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Conversation session created successfully',
  })
  async createConversation(@Body() dto: CreateConversationDto) {
    return this.chatService.createConversation(dto.userId, dto.title);
  }

  /**
   * Retrieves all conversation sessions.
   */
  @Get()
  @ApiOperation({
    summary: 'List all conversations',
    description: 'Retrieves all conversation sessions, optionally filtered by user ID',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Optional user identifier filter',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of conversation sessions ordered by latest activity',
  })
  async getAllConversations(@Query('userId') userId?: string) {
    return this.chatService.getAllConversations(userId);
  }

  /**
   * Retrieves conversation session metadata and message history turns.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get conversation details',
    description: 'Retrieves single conversation session metadata and sequential message history',
  })
  @ApiParam({
    name: 'id',
    description: 'Conversation UUID primary key',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Conversation details with message turns',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Conversation session not found',
  })
  async getConversation(@Param('id') id: string) {
    return this.chatService.getConversation(id);
  }

  /**
   * Initiates a fresh chat session and streams generative response via Server-Sent Events (SSE).
   */
  @Post('messages')
  @Sse()
  @ApiOperation({
    summary: 'Start fresh chat and stream response (SSE)',
    description: 'Dynamically creates a new conversation session and streams generative LLM completion via SSE',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Server-Sent Events token stream established (emits created conversationId in SSE payloads)',
  })
  async sendFreshMessageStream(
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const abortController = new AbortController();
    if (req && typeof req.on === 'function') {
      req.on('close', () => {
        abortController.abort();
      });
    }

    return this.chatService.sendMessageStream({
      userQuery: dto.query,
      userId: dto.userId,
      title: dto.title,
      topK: dto.topK,
      similarityThreshold: dto.similarityThreshold,
      signal: abortController.signal,
      traceId: dto.traceId,
    });
  }

  /**
   * Sends user query message turn to existing conversation (or "new") and streams generative response via Server-Sent Events (SSE).
   */
  @Post(':id/messages')
  @Sse()
  @ApiOperation({
    summary: 'Send message to conversation and stream response (SSE)',
    description: 'Triggers vector retrieval for conversation ID (or "new") and streams generative LLM completion tokens via SSE',
  })
  @ApiParam({
    name: 'id',
    description: 'Target conversation session UUID or "new"',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Server-Sent Events token stream established',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Target conversation session not found',
  })
  async sendMessageStream(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const abortController = new AbortController();
    if (req && typeof req.on === 'function') {
      req.on('close', () => {
        abortController.abort();
      });
    }

    const conversationId = id === 'new' ? undefined : id;

    return this.chatService.sendMessageStream({
      conversationId,
      userQuery: dto.query,
      userId: dto.userId,
      title: dto.title,
      topK: dto.topK,
      similarityThreshold: dto.similarityThreshold,
      signal: abortController.signal,
      traceId: dto.traceId,
    });
  }
}
