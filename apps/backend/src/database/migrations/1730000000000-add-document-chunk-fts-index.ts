import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentChunkFtsIndex1730000000000
  implements MigrationInterface {
  name = 'AddDocumentChunkFtsIndex1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "idx_document_chunks_content_fts"
      ON "document_chunks"
      USING GIN (to_tsvector('english', "content"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_document_chunks_content_fts"
    `);
  }
}