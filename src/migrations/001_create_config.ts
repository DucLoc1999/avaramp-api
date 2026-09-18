import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('config', (t) => {
    t.increments('id');
    t.string('key', 100).notNullable().unique();
    t.string('value', 255).notNullable();
    t.string('description', 500);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex('config').insert([
    { key: 'spread_buy',     value: '50',    description: 'VND added to Binance P2P price for buy orders' },
    { key: 'spread_sell',    value: '50',    description: 'VND subtracted from Binance P2P price for sell orders' },
    { key: 'fee_rate_buy',   value: '0.008', description: 'Fee rate for buy orders (0.8%)' },
    { key: 'fee_rate_sell',  value: '0.008', description: 'Fee rate for sell orders (0.8%)' },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('config');
}
