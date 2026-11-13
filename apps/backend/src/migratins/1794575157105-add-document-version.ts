import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentVersion1794575157105 implements MigrationInterface {
    name = 'AddDocumentVersion1794575157105'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" ADD "current_version_id" uuid`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_document_versions_document_version" ON "document_versions" ("document_id", "version_number") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_document_versions_document_version"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "current_version_id"`);
    }

}
