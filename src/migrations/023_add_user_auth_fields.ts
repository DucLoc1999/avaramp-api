import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('google_id', 255).unique().nullable();
    table.enu('kyc_status', ['none', 'pending', 'approved', 'rejected']).defaultTo('none').notNullable();
    table.timestamp('kyc_verified_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('google_id');
    table.dropColumn('kyc_status');
    table.dropColumn('kyc_verified_at');
  });
}
