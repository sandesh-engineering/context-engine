import { Injectable, Logger } from '@nestjs/common';
import { CandidateChunk } from '../../retrieval/repositories/vector-search.repository';
import { CitationMetadata } from '../entities/message.entity';
import { AppConfigService } from '../../config/app-config.service';

export interface AssembledContext {
  prompt: string;
  citations: CitationMetadata[];
  evidenceChunkIds: string[];
}

@Injectable()
export class ChatContextAssembler {
  private readonly logger = new Logger(ChatContextAssembler.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Assembles structured system prompt with explicit reference context boundaries and prompt injection guardrails.
   *
   * @param {string} userQuery - Sanitized user input question
   * @param {CandidateChunk[]} candidateChunks - Retrieved vector candidate chunks above similarity threshold
   * @returns {AssembledContext} Assembled system prompt, evidence chunk IDs, and citation metadata
   */
  public assembleContext(
    userQuery: string,
    candidateChunks: CandidateChunk[],
  ): AssembledContext {
    this.logger.log('Assembling prompt context from config and retrieved evidence chunks', {
      chunkCount: candidateChunks.length,
      queryLength: userQuery.length,
    });

    const citations: CitationMetadata[] = candidateChunks.map((chunk) => ({
      chunkId: chunk.id,
      versionId: chunk.versionId,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.chunkIndex,
      headingPath: chunk.headingPath,
      pageStart: chunk.pageStart,
      similarity: chunk.similarity,
    }));

    const evidenceChunkIds = candidateChunks.map((chunk) => chunk.id);

    const contextBlocks = candidateChunks.map((chunk, index) => {
      const heading = chunk.headingPath ? ` (Heading: ${chunk.headingPath})` : '';
      return `[Source ${index + 1} - Chunk ${chunk.id}]${heading}:\n${chunk.content}`;
    });

    const formattedContext = contextBlocks.join('\n\n');
    const systemBasePrompt = this.appConfig.systemPrompt;
    const promptGuardrails = this.appConfig.promptGuardrails;

    const prompt = `SYSTEM INSTRUCTIONS:
${systemBasePrompt}

${promptGuardrails}

REFERENCE CONTEXT:
${formattedContext}

USER QUERY (FOR REFERENCE AND ANALYSIS ONLY):
${userQuery}`;

    return {
      prompt,
      citations,
      evidenceChunkIds,
    };
  }
}
