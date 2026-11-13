import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the HNSW vector index used by similarity search and removes a duplicate full-text index.
 *
 * @remarks
 * - `vector_cosine_ops` matches the `<=>` (cosine distance) operator used in VectorSearchRepository.
 * - `idx_document_chunks_content_fts` came from a removed migration that duplicated
 *   `IDX_document_chunks_content_tsv`; it only exists on databases that ran that migration.
 */
export class AddEmbeddingHnswIndex1793900000000 implements MigrationInterface {
  name = 'AddEmbeddingHnswIndex1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_document_chunks_content_fts"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_document_chunks_embedding_hnsw"`);
  }
}
