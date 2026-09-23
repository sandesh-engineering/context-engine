import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ConversationEntity, MessageEntity } from './entities';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ChatContextAssembler } from './services/chat-context-assembler.service';
import { ChatService } from './services/chat.service';
import { ChatController } from './chat.controller';
import { OllamaLlmProvider } from './providers/ollama-llm.provider';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity]),
    RetrievalModule,
  ],
  controllers: [ChatController],
  providers: [
    AppConfigService,
    ChatContextAssembler,
    ChatService,
    OllamaLlmProvider,
    {
      provide: LLM_PROVIDER,
      useClass: OllamaLlmProvider,
    },
  ],
  exports: [
    ChatService,
    ChatContextAssembler,
    LLM_PROVIDER,
  ],
})
export class ChatModule { }
