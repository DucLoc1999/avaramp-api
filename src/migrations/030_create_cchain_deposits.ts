import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

/**
 * 030: C-Chain deposits detected on custodial wallet addresses.
 *
 * Records native AVAX balance inflows and ERC-20 native USDT `Transfer` events
 * credited to a custodial deposit address. `status` drives the sweep lifecycle:
 * detected → confirmed → sweeping → swept | failed. Dedup is enforced via the
 * unique (address, asset, tx_hash, log_index) key so a re-scanned range is never
 * processed twice.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('cchain_deposits', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().nullable();
    t.string('address', 64).notNullable();
    t.string('asset', 16).notNullable(); // 'avax' | 'usdt'
    t.string('amount', 80).notNullable();
    t.string('block_hash', 128).nullable();
    t.string('block_number', 80).nullable();
    t.string('tx_hash', 256).nullable();
    t.integer('log_index').nullable();
    t.string('status', 20).notNullable().defaultTo('detected'); // detected|confirmed|sweeping|swept|failed
    t.string('sweep_tx_hash', 256).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.unique(['address', 'asset', 'tx_hash', 'log_index']);
    t.index(['order_id']);
    t.index(['address']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('cchain_deposits');
}