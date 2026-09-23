import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({
    description: 'Optional tenant or user identifier for session owner',
    example: 'user-001',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Optional initial title for the conversation session',
    example: 'Security Compliance Q&A',
  })
  @IsOptional()
  @IsString()
  title?: string;
}
