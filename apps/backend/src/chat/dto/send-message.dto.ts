import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_QUERY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_TOP_K,
} from './chat-limits';

export class SendMessageDto {
  @ApiProperty({
    description: 'Natural language question or message query',
    example: 'How are database credentials managed in AWS?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_QUERY_LENGTH)
  query!: string;

  @ApiPropertyOptional({
    description: 'Optional user identifier when initiating dynamic fresh chat',
    example: 'user-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  userId?: string;

  @ApiPropertyOptional({
    description: 'Optional custom title when initiating dynamic fresh chat',
    example: 'AWS Credentials Strategy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional distributed tracing correlation identifier',
    example: 'trace-8849-xyz',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH)
  traceId?: string;

  @ApiPropertyOptional({
    description: 'Optional top-K candidate chunks to retrieve and rank',
    example: 5,
    minimum: 1,
    maximum: MAX_TOP_K,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TOP_K)
  topK?: number;

  @ApiPropertyOptional({
    description: 'Optional minimum similarity threshold filter',
    example: 0.5,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityThreshold?: number;
}
