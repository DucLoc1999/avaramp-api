import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('callback_logs', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().references('id').inTable('orders').onDelete('CASCADE');
    t.string('callback_url', 512).notNullable();
    t.jsonb('payload').notNullable();
    t.integer('attempts').defaultTo(0);
    t.string('status', 32).defaultTo('pending');
    t.timestamp('last_attempt_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX idx_callback_logs_order_id ON ${schema}.callback_logs(order_id)
  `);

  await knex.schema.withSchema(schema).raw(`
    CREATE INDEX idx_callback_logs_status ON ${schema}.callback_logs(status)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('callback_logs');
}