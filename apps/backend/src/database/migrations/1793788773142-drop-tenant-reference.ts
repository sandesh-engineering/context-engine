import { MigrationInterface, QueryRunner } from "typeorm";

export class DropTenantReference1793788773142 implements MigrationInterface {
    name = 'DropTenantReference1793788773142'

    public async up(queryRunner: QueryRunner): Promise<void> {
        /* IF EXISTS: this index was created outside migrations, so fresh databases never had it */
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."document_chunks_embedding_hnsw_idx"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "tenant_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" ADD "tenant_id" character varying NOT NULL`);
        await queryRunner.query(`CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" ("embedding") WHERE (embedding IS NOT NULL)`);
    }

}
