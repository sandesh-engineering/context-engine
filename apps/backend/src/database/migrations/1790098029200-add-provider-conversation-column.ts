import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProviderConversationColumn1790098029200 implements MigrationInterface {
    name = 'AddProviderConversationColumn1790098029200'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD "provider_session_id" character varying`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "context_state" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "context_state"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "provider_session_id"`);
    }

}
