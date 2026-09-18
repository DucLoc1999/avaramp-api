import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  // Backfill: sync payment_status with order_state for existing inconsistent rows
  await knex.raw(`
    UPDATE ${schema}.orders
    SET payment_status = 'payment_received'
    WHERE order_state IN (2, 3, 4) AND payment_status = 'pending'
  `);

  // Drop unused checkout_url column
  const hasCheckoutUrl = await knex.schema.withSchema(schema).hasColumn('orders', 'checkout_url');
  if (hasCheckoutUrl) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.dropColumn('checkout_url');
    });
  }

  // Drop redundant sepay_transaction_id from orders (data lives in webhook_logs)
  await knex.schema.withSchema(schema).raw(
    `DROP INDEX IF EXISTS ${schema}.idx_orders_sepay_transaction_id`
  );
  const hasSepayTxId = await knex.schema.withSchema(schema).hasColumn('orders', 'sepay_transaction_id');
  if (hasSepayTxId) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.dropColumn('sepay_transaction_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.string('checkout_url', 500);
    t.string('sepay_transaction_id', 100);
  });

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX IF NOT EXISTS idx_orders_sepay_transaction_id
    ON ${schema}.orders (sepay_transaction_id)
  `);
}
