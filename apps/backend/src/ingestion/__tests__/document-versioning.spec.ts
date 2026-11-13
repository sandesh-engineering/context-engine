import { Readable } from 'stream';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/* file-type is ESM-only and cannot be loaded by Jest; detection itself is covered elsewhere */
jest.mock('file-type', () => ({
  fileTypeStream: jest.fn(async (webStream: ReadableStream) =>
    Object.assign(webStream, { fileType: { mime: 'application/pdf', ext: 'pdf' } }),
  ),
}));

import { IngestionService } from '../ingestion.service';
import { MemoryStorageAdapter } from '../storage/adapters/memory-storage.adapter';
import { StoragePathBuilder } from '../services/storage-path-builder.service';
import { IngestionJobStage, IngestionJobStatus } from '../common/enums';

const pdfStream = () => Readable.from([Buffer.from('%PDF-1.7\nRevised policy text')]);

describe('IngestionService document versioning', () => {
  let service: IngestionService;
  let storage: MemoryStorageAdapter;
  let persistence: any;
  let jobsRepository: any;
  let documentsRepository: any;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    jest.spyOn(storage, 'deleteObject');

    const persisted = (versionNumber: number) => ({
      document: { id: 'doc-1', createdAt: new Date() },
      version: { id: `ver-${versionNumber}`, versionNumber },
      job: { id: `job-${versionNumber}`, status: IngestionJobStatus.PENDING, stage: IngestionJobStage.SOURCE_READY },
    });
    persistence = {
      persistUploadedDocument: jest.fn().mockResolvedValue(persisted(1)),
      persistNewVersion: jest.fn().mockResolvedValue(persisted(2)),
    };
    jobsRepository = {
      findReusableJobByDigest: jest.fn().mockResolvedValue(null),
      findRecentJobs: jest.fn(),
    };
    documentsRepository = {
      exists: jest.fn().mockResolvedValue(true),
      findByCurrentFilename: jest.fn().mockResolvedValue([]),
      deleteWithVersions: jest.fn(),
    };

    service = new IngestionService(
      storage,
      persistence,
      jobsRepository,
      documentsRepository,
      new StoragePathBuilder(),
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
  });

  describe('uploadDocument with documentId', () => {
    it('stores the file as the next version of that document', async () => {
      const result = await service.uploadDocument({
        stream: pdfStream(),
        originalFilename: 'policy-2026.pdf',
        title: 'policy-2026.pdf',
        documentId: 'doc-1',
      });

      expect(persistence.persistNewVersion).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ originalFilename: 'policy-2026.pdf', mimeType: 'application/pdf' }),
      );
      expect(persistence.persistUploadedDocument).not.toHaveBeenCalled();
      expect(result).toMatchObject({ documentId: 'doc-1', versionId: 'ver-2', versionNumber: 2 });
    });

    it('only treats identical bytes as a duplicate within the same document', async () => {
      await service.uploadDocument({
        stream: pdfStream(),
        originalFilename: 'policy.pdf',
        title: 'policy.pdf',
        documentId: 'doc-1',
      });

      expect(jobsRepository.findReusableJobByDigest).toHaveBeenCalledWith(expect.any(String), 'doc-1');
    });

    it('rejects an unknown document before storing anything', async () => {
      documentsRepository.exists.mockResolvedValue(false);
      const streamToStorage = jest.spyOn(storage, 'streamToStorage');

      await expect(
        service.uploadDocument({
          stream: pdfStream(),
          originalFilename: 'policy.pdf',
          title: 'policy.pdf',
          documentId: 'missing-doc',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(streamToStorage).not.toHaveBeenCalled();
      expect(persistence.persistNewVersion).not.toHaveBeenCalled();
    });

    it('removes the stored file and keeps the 404 when the document is deleted mid-upload', async () => {
      persistence.persistNewVersion.mockRejectedValue(new NotFoundException('Document not found'));

      await expect(
        service.uploadDocument({
          stream: pdfStream(),
          originalFilename: 'policy.pdf',
          title: 'policy.pdf',
          documentId: 'doc-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteDocument', () => {
    it('deletes the stored file of every version', async () => {
      documentsRepository.deleteWithVersions.mockResolvedValue(['key-v1', 'key-v2']);

      await service.deleteDocument('doc-1');

      expect(storage.deleteObject).toHaveBeenCalledWith('key-v1');
      expect(storage.deleteObject).toHaveBeenCalledWith('key-v2');
    });

    it('throws NotFound for an unknown document', async () => {
      documentsRepository.deleteWithVersions.mockResolvedValue(null);

      await expect(service.deleteDocument('missing-doc')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still succeeds when a stored file cannot be removed', async () => {
      documentsRepository.deleteWithVersions.mockResolvedValue(['key-v1']);
      (storage.deleteObject as jest.Mock).mockRejectedValueOnce(new Error('S3 unavailable'));

      await expect(service.deleteDocument('doc-1')).resolves.toBeUndefined();
    });
  });

  describe('findPossibleVersionTargets', () => {
    it('looks up documents by the trimmed file name', async () => {
      await service.findPossibleVersionTargets('  policy.pdf ');
      expect(documentsRepository.findByCurrentFilename).toHaveBeenCalledWith('policy.pdf');
    });

    it('rejects an empty file name', async () => {
      await expect(service.findPossibleVersionTargets('  ')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getRecentJobs', () => {
    it('marks only the job of the current version as current', async () => {
      const document = { title: 'Policy', currentVersionId: 'ver-2' };
      jobsRepository.findRecentJobs.mockResolvedValue([
        {
          id: 'job-2',
          versionId: 'ver-2',
          status: IngestionJobStatus.COMPLETED,
          createdAt: new Date(),
          version: { documentId: 'doc-1', versionNumber: 2, originalFilename: 'policy-v2.pdf', byteSize: 10, document },
        },
        {
          id: 'job-1',
          versionId: 'ver-1',
          status: IngestionJobStatus.COMPLETED,
          createdAt: new Date(),
          version: { documentId: 'doc-1', versionNumber: 1, originalFilename: 'policy.pdf', byteSize: 10, document },
        },
      ]);

      const jobs = await service.getRecentJobs();

      expect(jobs.map((job) => [job.versionNumber, job.isCurrent])).toEqual([
        [2, true],
        [1, false],
      ]);
      expect(jobs[0]).toMatchObject({ documentId: 'doc-1', versionId: 'ver-2' });
    });
  });
});
