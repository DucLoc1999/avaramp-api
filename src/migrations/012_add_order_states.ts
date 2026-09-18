import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  const hasProcessingState = await knex.schema.withSchema(schema).hasColumn('orders', 'processing_state');
  const hasLastWebhookId = await knex.schema.withSchema(schema).hasColumn('orders', 'last_webhook_id');

  if (!hasProcessingState) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.integer('processing_state').defaultTo(10);
    });
  }

  if (!hasLastWebhookId) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.string('last_webhook_id', 100);
    });
  }

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX IF NOT EXISTS idx_orders_states
    ON ${schema}.orders (order_state, processing_state)
  `);

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX IF NOT EXISTS idx_orders_payment_code
    ON ${schema}.orders (payment_code)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).raw(`DROP INDEX IF EXISTS ${schema}.idx_orders_payment_code`);
  await knex.schema.withSchema(schema).raw(`DROP INDEX IF EXISTS ${schema}.idx_orders_states`);
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('last_webhook_id');
    t.dropColumn('processing_state');
  });
}