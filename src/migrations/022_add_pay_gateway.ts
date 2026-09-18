import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.withSchema(schema).hasColumn('orders', 'pay_gateway');
  if (hasColumn) return;

  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.string('pay_gateway', 20).notNullable().defaultTo('bank');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('orders', (t) => {
    t.dropColumn('pay_gateway');
  });
}
