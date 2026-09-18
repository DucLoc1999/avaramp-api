import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.integer('chain_id');
    t.string('token_address', 100);
    t.string('recipient', 100);
    t.string('callback', 500);
    t.string('bank_id', 50);
    t.string('bank_account_name', 100);
    t.string('bank_account_no', 50);
    t.integer('order_state').defaultTo(1);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('chain_id');
    t.dropColumn('token_address');
    t.dropColumn('recipient');
    t.dropColumn('callback');
    t.dropColumn('bank_id');
    t.dropColumn('bank_account_name');
    t.dropColumn('bank_account_no');
    t.dropColumn('order_state');
  });
}
