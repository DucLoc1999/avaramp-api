import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('fee_audit_log', (t) => {
    t.bigIncrements('id');
    t.string('config_key', 100).notNullable();
    t.string('old_value', 255);
    t.string('new_value', 255).notNullable();
    t.string('changed_by', 100);
    t.timestamp('changed_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('fee_audit_log');
}
