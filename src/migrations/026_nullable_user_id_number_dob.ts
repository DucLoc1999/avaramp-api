import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('users', (t) => {
    t.string('id_number', 20).nullable().alter();
    t.date('dob').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('users', (t) => {
    t.string('id_number', 20).notNullable().alter();
    t.date('dob').notNullable().alter();
  });
}
