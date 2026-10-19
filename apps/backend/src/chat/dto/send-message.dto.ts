import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    description: 'Natural language question or message query',
    example: 'How are database credentials managed in AWS?',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({
    description: 'Optional tenant/user identifier when initiating dynamic fresh chat',
    example: 'user-001',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Optional custom title when initiating dynamic fresh chat',
    example: 'AWS Credentials Strategy',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional distributed tracing correlation identifier',
    example: 'trace-8849-xyz',
  })
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiPropertyOptional({
    description: 'Optional top-K candidate chunks to retrieve and rank',
    example: 5,
  })
  @IsOptional()
  topK?: number;

  @ApiPropertyOptional({
    description: 'Optional minimum similarity threshold filter',
    example: 0.5,
  })
  @IsOptional()
  similarityThreshold?: number;
}
