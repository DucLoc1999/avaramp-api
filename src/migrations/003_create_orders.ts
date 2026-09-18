import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('orders', (t) => {
    t.increments('id');
    t.string('payment_code', 20).unique();
    t.string('checkout_url', 500);
    t.string('sepay_transaction_id', 100);
    t.bigInteger('vnd_received');
    t.timestamp('payment_confirmed_at');
    t.enum('direction', ['buy', 'sell']).notNullable();
    t.decimal('usdt_amount', 18, 8).notNullable();
    t.bigInteger('rate').notNullable();
    t.bigInteger('net_vnd').notNullable();
    t.decimal('fee_rate', 10, 6).notNullable();
    t.bigInteger('fee_vnd').notNullable();
    t.string('payment_status', 30).defaultTo('pending');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX idx_orders_payment_status_created_at 
    ON ${schema}.orders (payment_status, created_at)
  `);

  await knex.schema.withSchema(schema).raw(`
    CREATE OR REPLACE FUNCTION ${schema}.update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await knex.schema.withSchema(schema).raw(`
    CREATE TRIGGER trigger_orders_updated_at
    BEFORE UPDATE ON ${schema}.orders
    FOR EACH ROW
    EXECUTE FUNCTION ${schema}.update_updated_at()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).raw(`DROP TRIGGER IF EXISTS trigger_orders_updated_at ON ${schema}.orders`);
  await knex.schema.withSchema(schema).raw(`DROP FUNCTION IF EXISTS ${schema}.update_updated_at`);
  await knex.schema.withSchema(schema).raw(`DROP INDEX IF EXISTS ${schema}.idx_orders_payment_status_created_at`);
  await knex.schema.withSchema(schema).dropTableIfExists('orders');
}
