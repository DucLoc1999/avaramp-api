import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (t) => {
    t.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (t) => {
    t.dropIndex('user_id');
    t.dropColumn('user_id');
  });
}
