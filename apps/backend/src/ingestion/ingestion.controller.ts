import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import busboy from 'busboy';
import { IngestionService } from './ingestion.service';
import { Tenant } from './common/tenant.decorator';
import type { TenantContext } from './common/tenant.decorator';

@ApiTags('Ingestion')
@Controller('documents')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  /**
   * Accepts a direct single-document multipart/form-data upload stream.
   *
   * @remarks
   * - Streams binary directly to object storage with bounded memory buffers.
   * - Validates PDF magic bytes and size constraints in real-time.
   * - Atomically persists metadata and Transactional Outbox event.
   *
   * @param {Request} req - Raw express request containing multipart stream
   * @param {Response} res - Express response object
   * @param {TenantContext} tenant - Authenticated tenant context
   * @param {string} traceIdHeader - Optional distributed trace identifier
   * @returns {Promise<void>} Sends HTTP 202 Accepted with job metadata
   * @throws {BadRequestException} Throws if format is invalid or file missing
   *
   * @example
   * ```http
   * POST /documents/upload
   * Content-Type: multipart/form-data
   * ```
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Upload a single document',
    description: 'Streams a document (PDF) directly to object storage and enqueues ingestion job',
  })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'x-tenant-id',
    required: false,
    description: 'Tenant identifier (if not provided by session/auth middleware)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF document file binary',
        },
        title: {
          type: 'string',
          description: 'Optional human-readable document title',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Document stream validated, stored, and ingestion job queued',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file format, missing tenant, or corrupt stream',
  })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'File size exceeds allowed maximum bytes threshold',
  })
  async uploadDocument(
    @Req() req: Request,
    @Res() res: Response,
    @Tenant() tenant: TenantContext,
    @Headers('x-trace-id') traceIdHeader?: string,
  ): Promise<void> {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      throw new BadRequestException('Request Content-Type must be multipart/form-data');
    }

    const traceId = traceIdHeader || req.headers['traceparent']?.toString();

    let titleField: string | undefined;
    let fileHandled = false;
    let uploadPromise: Promise<any> | null = null;

    const bb = busboy({ headers: req.headers });

    bb.on('field', (name, val) => {
      if (name === 'title' && val.trim().length > 0) {
        titleField = val.trim();
      }
    });

    bb.on('file', (name, fileStream, info) => {
      if (fileHandled) {
        /* Only single document upload per request is supported */
        fileStream.resume();
        return;
      }
      fileHandled = true;

      const filename = info.filename || 'document.pdf';
      const effectiveTitle = titleField || filename;

      uploadPromise = this.ingestionService.uploadDocument({
        stream: fileStream,
        originalFilename: filename,
        title: effectiveTitle,
        tenantId: tenant.tenantId,
        traceId,
      });
    });

    bb.on('error', (err: Error) => {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Multipart parsing error: ${err.message}`,
      });
    });

    bb.on('close', async () => {
      if (!fileHandled || !uploadPromise) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'No file was provided in the multipart request',
        });
      }

      try {
        const result = await uploadPromise;
        return res.status(HttpStatus.ACCEPTED).json({
          statusCode: HttpStatus.ACCEPTED,
          data: result,
        });
      } catch (err: any) {
        const status = err.status || err.statusCode || HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          statusCode: status,
          message: err.message || 'Failed to process document upload',
        });
      }
    });

    req.pipe(bb);
  }
}
