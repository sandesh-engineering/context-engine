import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_IDENTIFIER_LENGTH, MAX_TITLE_LENGTH } from './chat-limits';

export class CreateConversationDto {
  @ApiPropertyOptional({
    description: 'Optional user identifier for session owner',
    example: 'user-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  userId?: string;

  @ApiPropertyOptional({
    description: 'Optional initial title for the conversation session',
    example: 'Security Compliance Q&A',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;
}
