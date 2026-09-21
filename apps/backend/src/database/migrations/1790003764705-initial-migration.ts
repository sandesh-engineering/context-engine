import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1790003764705 implements MigrationInterface {
    name = 'InitialMigration1790003764705'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ingestion_jobs_status_enum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')`);
        await queryRunner.query(`CREATE TYPE "public"."ingestion_jobs_stage_enum" AS ENUM('DOWNLOADING', 'UPLOADING', 'VERIFYING', 'SOURCE_READY', 'PARSING', 'CHUNKING', 'EMBEDDING', 'INDEXING')`);
        await queryRunner.query(`CREATE TABLE "ingestion_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version_id" uuid NOT NULL, "status" "public"."ingestion_jobs_status_enum" NOT NULL DEFAULT 'PENDING', "stage" "public"."ingestion_jobs_stage_enum" NOT NULL DEFAULT 'SOURCE_READY', "attempt_count" integer NOT NULL DEFAULT '0', "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_a6f6ffb2ecec3947e12ad997be" UNIQUE ("version_id"), CONSTRAINT "PK_78a3cba789582043cfc8ba82edd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "document_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "version_number" integer NOT NULL DEFAULT '1', "storage_key" character varying NOT NULL, "sha256_digest" character varying NOT NULL, "byte_size" bigint NOT NULL, "mime_type" character varying NOT NULL DEFAULT 'application/pdf', "original_filename" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_baf26dab035c6d6fc433f9dc6a2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."documents_source_type_enum" AS ENUM('direct_upload', 'external_url', 's3_direct')`);
        await queryRunner.query(`CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "title" character varying NOT NULL, "source_type" "public"."documents_source_type_enum" NOT NULL DEFAULT 'direct_upload', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ingestion_outbox_domain_enum" AS ENUM('DOCUMENT', 'INGESTION')`);
        await queryRunner.query(`CREATE TABLE "ingestion_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying NOT NULL, "topic" character varying NOT NULL, "version" integer NOT NULL DEFAULT '0', "domain" "public"."ingestion_outbox_domain_enum" NOT NULL DEFAULT 'DOCUMENT', "payload" jsonb NOT NULL, "retries" integer NOT NULL DEFAULT '0', "processed" boolean NOT NULL DEFAULT false, "processed_at" TIMESTAMP, "failed_at" TIMESTAMP, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0e0c0a91c7252789c52cd9fa452" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cc60b4c655823b365539f2c132" ON "ingestion_outbox" ("processed") `);
        await queryRunner.query(`CREATE TYPE "public"."embedding_outbox_domain_enum" AS ENUM('DOCUMENT', 'INGESTION')`);
        await queryRunner.query(`CREATE TABLE "embedding_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying NOT NULL, "topic" character varying NOT NULL, "version" integer NOT NULL DEFAULT '0', "domain" "public"."embedding_outbox_domain_enum" NOT NULL DEFAULT 'DOCUMENT', "payload" jsonb NOT NULL, "retries" integer NOT NULL DEFAULT '0', "processed" boolean NOT NULL DEFAULT false, "processed_at" TIMESTAMP, "failed_at" TIMESTAMP, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fc11c3a9fa4d43d263fdebe891f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d2db932aff7362690c61baa5db" ON "embedding_outbox" ("processed") `);
        await queryRunner.query(`CREATE TABLE "document_chunks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version_id" uuid NOT NULL, "chunk_index" integer NOT NULL, "content" text NOT NULL, "heading_path" character varying, "page_start" integer, "page_end" integer, "token_count" integer NOT NULL DEFAULT '0', "start_char_offset" integer NOT NULL DEFAULT '0', "end_char_offset" integer NOT NULL DEFAULT '0', "embedding" vector(768), "metadata_json" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7f9060084e9b872dbb567193978" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c4f9cd039c16d832482c82b205" ON "document_chunks" ("version_id", "chunk_index") `);
        await queryRunner.query(`ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "FK_a6f6ffb2ecec3947e12ad997be2" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "document_versions" ADD CONSTRAINT "FK_ac75577bca976d6d581b0f459b6" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "document_chunks" ADD CONSTRAINT "FK_ea33bd18135cf91a0c62bfc4ac9" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "document_chunks" DROP CONSTRAINT "FK_ea33bd18135cf91a0c62bfc4ac9"`);
        await queryRunner.query(`ALTER TABLE "document_versions" DROP CONSTRAINT "FK_ac75577bca976d6d581b0f459b6"`);
        await queryRunner.query(`ALTER TABLE "ingestion_jobs" DROP CONSTRAINT "FK_a6f6ffb2ecec3947e12ad997be2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c4f9cd039c16d832482c82b205"`);
        await queryRunner.query(`DROP TABLE "document_chunks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d2db932aff7362690c61baa5db"`);
        await queryRunner.query(`DROP TABLE "embedding_outbox"`);
        await queryRunner.query(`DROP TYPE "public"."embedding_outbox_domain_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cc60b4c655823b365539f2c132"`);
        await queryRunner.query(`DROP TABLE "ingestion_outbox"`);
        await queryRunner.query(`DROP TYPE "public"."ingestion_outbox_domain_enum"`);
        await queryRunner.query(`DROP TABLE "documents"`);
        await queryRunner.query(`DROP TYPE "public"."documents_source_type_enum"`);
        await queryRunner.query(`DROP TABLE "document_versions"`);
        await queryRunner.query(`DROP TABLE "ingestion_jobs"`);
        await queryRunner.query(`DROP TYPE "public"."ingestion_jobs_stage_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ingestion_jobs_status_enum"`);
    }

}
