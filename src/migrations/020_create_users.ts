import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('users', (t) => {
    t.increments('id').primary();
    t.string('id_number', 20).notNullable().unique();
    t.string('name', 255).notNullable();
    t.date('dob').notNullable();
    t.string('sex', 10).nullable();
    t.string('nationality', 100).nullable();
    t.string('home', 500).nullable();
    t.string('address', 500).nullable();
    t.date('doe').nullable();
    t.string('phone', 20).nullable();
    t.string('email', 255).nullable();
    t.text('kyc_image_front').nullable();
    t.text('kyc_image_back').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['phone']);
    t.index(['email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('users');
}
