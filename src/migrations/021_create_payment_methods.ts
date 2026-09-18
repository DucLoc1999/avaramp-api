import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('payment_methods', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable();
    t.foreign('user_id').references('id').inTable(`${schema}.users`).onDelete('CASCADE');
    t.enum('type', ['BANK', 'CRYPTO']).notNullable();
    t.string('wallet_address', 255).nullable();
    t.integer('bank_id').nullable();
    t.string('full_name', 255).nullable();
    t.string('bank_account', 255).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('payment_methods');
}
