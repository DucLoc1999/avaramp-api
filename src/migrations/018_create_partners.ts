import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('partners', (t) => {
    t.uuid('id').primary();
    t.string('name', 255).notNullable();
    t.string('key', 255).notNullable().unique();
    t.decimal('fee_buy', 10, 6).notNullable().defaultTo(0);
    t.decimal('fee_sell', 10, 6).notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  const hasPartnerId = await knex.schema.withSchema(schema).hasColumn('orders', 'partner_id');
  if (!hasPartnerId) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.uuid('partner_id').nullable();
      t.index(['partner_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasPartnerId = await knex.schema.withSchema(schema).hasColumn('orders', 'partner_id');
  if (hasPartnerId) {
    await knex.schema.withSchema(schema).alterTable('orders', (t) => {
      t.dropColumn('partner_id');
    });
  }

  await knex.schema.withSchema(schema).dropTableIfExists('partners');
}
