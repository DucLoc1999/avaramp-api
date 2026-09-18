import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX idx_orders_sepay_transaction_id 
    ON ${schema}.orders (sepay_transaction_id)
  `);

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX idx_orders_order_state 
    ON ${schema}.orders (order_state)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).raw(`DROP INDEX IF EXISTS ${schema}.idx_orders_sepay_transaction_id`);
  await knex.schema.withSchema(schema).raw(`DROP INDEX IF EXISTS ${schema}.idx_orders_order_state`);
}