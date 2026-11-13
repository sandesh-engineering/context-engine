import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  HttpException,
  Headers,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import busboy from 'busboy';
import { IngestionService } from './ingestion.service';

/* Types safe to render in the browser; anything else is forced to download. */
const INLINE_MIME_TYPES = new Set(['application/pdf', 'text/plain']);

function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* Client errors keep their message; anything else is logged server-side and stays generic. */
function toUploadErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof HttpException && err.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR) {
    return { status: err.getStatus(), message: err.message };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Failed to process document upload',
  };
}

@ApiTags('Ingestion')
@Controller('documents')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) { }

  /**
   * Retrieves recent ingestion jobs.
   */
  @Get()
  @ApiOperation({
    summary: 'List recent document ingestion jobs',
    description: 'Retrieves recent ingestion jobs with status and document details',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of jobs to return (default 30, max 100)',
  })
  async getRecentIngestions(
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    /* The service clamps the range */
    return this.ingestionService.getRecentJobs(limit);
  }

  /**
   * Lists documents whose current version has the given file name.
   *
   * @remarks
   * The upload form calls this before uploading, to ask whether the file is a new version of an
   * existing document. A shared name is only a hint; nothing is replaced without the user's choice.
   */
  @Get('filename-matches')
  @ApiOperation({
    summary: 'Find documents with the same file name',
    description: 'Returns documents whose current version was uploaded under this file name',
  })
  @ApiQuery({ name: 'filename', required: true, type: String })
  async findFilenameMatches(@Query('filename') filename: string) {
    return this.ingestionService.findPossibleVersionTargets(filename);
  }

  /**
   * Deletes a document with all its versions; it stops appearing in answers immediately.
   */
  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a document',
    description: 'Removes the document, its versions, chunks and stored files',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Document deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Document not found' })
  async deleteDocument(
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<void> {
    await this.ingestionService.deleteDocument(documentId);
  }

  /**
   * Streams the original stored file of a document version so cited sources can be opened.
   *
   * @remarks
   * - Only PDF and plain text render inline; other types are sent as attachments
   *   so stored HTML can never execute in the API origin.
   */
  @Get('versions/:versionId/file')
  @ApiOperation({
    summary: 'Open a document version file',
    description: 'Streams the raw stored file for a document version referenced by a citation',
  })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async getDocumentFile(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.ingestionService.getDocumentFile(versionId);
    const mimeType = (file.mimeType || '').toLowerCase();
    const inline = INLINE_MIME_TYPES.has(mimeType);

    res.setHeader('Content-Type', inline ? mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.filename || 'document'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (file.byteSize > 0) {
      res.setHeader('Content-Length', String(file.byteSize));
    }

    file.stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(HttpStatus.BAD_GATEWAY).json({ message: 'Failed to read document from storage' });
      } else {
        res.destroy(err);
      }
    });
    file.stream.pipe(res);
  }

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
    description: 'Invalid file format or corrupt stream',
  })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'File size exceeds allowed maximum bytes threshold',
  })
  async uploadDocument(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-trace-id') traceIdHeader?: string,
  ): Promise<void> {
    this.handleMultipartUpload(req, res, traceIdHeader);
  }

  /**
   * Uploads a new version of an existing document.
   *
   * @remarks
   * - The current version keeps answering until the new one is fully indexed, then it takes over
   *   and the old version's chunks are removed. A failed new version leaves the old one in place.
   * - Uploading bytes identical to an existing version of this document returns that version.
   */
  @Post(':documentId/versions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Upload a new version of a document',
    description: 'Streams a PDF as the next version of an existing document and enqueues its ingestion',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF document file binary' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: 'New version stored and ingestion job queued' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Document not found' })
  async uploadDocumentVersion(
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-trace-id') traceIdHeader?: string,
  ): Promise<void> {
    this.handleMultipartUpload(req, res, traceIdHeader, documentId);
  }

  /**
   * Streams a single-file multipart request into the ingestion service and writes the response.
   *
   * @param {string} [documentId] - Upload as a new version of this document instead of a new document
   */
  private handleMultipartUpload(
    req: Request,
    res: Response,
    traceIdHeader?: string,
    documentId?: string,
  ): void {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      throw new BadRequestException('Request Content-Type must be multipart/form-data');
    }

    const traceId = traceIdHeader || req.headers['traceparent']?.toString();

    let titleField: string | undefined;
    let fileHandled = false;
    let responded = false;
    let activeFileStream: Readable | undefined;

    /* A client that disconnects mid-upload ends neither busboy nor the file stream; fail the
       stream so the storage upload aborts its multipart upload and the request settles */
    req.on('close', () => {
      if (!req.complete && activeFileStream) {
        activeFileStream.destroy(new Error('Client disconnected during upload'));
      }
    });

    const respond = (status: number, body: Record<string, unknown>): void => {
      if (responded || res.headersSent) return;
      responded = true;
      res.status(status).json({ statusCode: status, ...body });
    };

    /* Stop feeding busboy and drain the rest of the request once a response is decided */
    const stopReading = (): void => {
      req.unpipe(bb);
      req.resume();
    };

    const bb = busboy({
      headers: req.headers,
      limits: {
        /* One byte over the cap so the service's size limiter rejects oversized
           files instead of busboy silently truncating them. */
        fileSize: this.ingestionService.maxUploadBytes + 1,
        files: 1,
      },
    });

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
      activeFileStream = fileStream;

      const filename = info.filename || 'document.pdf';
      const effectiveTitle = titleField || filename;

      /* Settle immediately: validation can reject while busboy is still reading,
         and a rejection left unhandled until 'close' would crash the process. */
      this.ingestionService
        .uploadDocument({
          stream: fileStream,
          originalFilename: filename,
          title: effectiveTitle,
          traceId,
          documentId,
        })
        .then(
          (data) => respond(HttpStatus.ACCEPTED, { data }),
          (err: unknown) => {
            const { status, message } = toUploadErrorResponse(err);
            respond(status, { message });
            stopReading();
          },
        );
    });

    bb.on('error', () => {
      respond(HttpStatus.BAD_REQUEST, { message: 'Malformed multipart request' });
      stopReading();
    });

    bb.on('close', () => {
      /* With a file present, the upload outcome sends the response */
      if (!fileHandled) {
        respond(HttpStatus.BAD_REQUEST, {
          message: 'No file was provided in the multipart request',
        });
      }
    });

    req.pipe(bb);
  }
}
