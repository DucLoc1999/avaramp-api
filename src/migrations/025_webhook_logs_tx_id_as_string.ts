import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('webhook_logs', (t) => {
    // SePay bank webhook sends numeric tx ids; PG IPN sends hex strings (e.g. 6a7077ffe6da1)
    t.string('sepay_transaction_id', 128).nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('webhook_logs', (t) => {
    t.bigInteger('sepay_transaction_id').nullable().alter();
  });
}
