import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('partners', (t) => {
    t.integer('creator').nullable().references('id').inTable(`${schema}.admins`);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).alterTable('partners', (t) => {
    t.dropColumn('creator');
  });
}
