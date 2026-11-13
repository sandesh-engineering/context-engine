import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentChunksContentFtsIndex1793194398431 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE INDEX "IDX_document_chunks_content_tsv" ON "document_chunks" USING GIN (to_tsvector('english', "content"))`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX "public"."IDX_document_chunks_content_tsv"`
        );
    }
}
