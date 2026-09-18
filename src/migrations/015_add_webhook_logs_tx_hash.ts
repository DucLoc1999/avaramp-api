import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('webhook_logs', (t) => {
    // Make sepay_transaction_id nullable so rows can store chain tx hashes instead
    t.bigInteger('sepay_transaction_id').nullable().alter();
    // Add tx_hash column for stellar chain deduplication
    t.string('tx_hash', 128).nullable().unique();
    // Add source column to distinguish webhook origins
    t.string('source', 20).nullable(); // 'sepay' | 'stellar'
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('webhook_logs', (t) => {
    t.dropColumn('tx_hash');
    t.dropColumn('source');
  });
}
