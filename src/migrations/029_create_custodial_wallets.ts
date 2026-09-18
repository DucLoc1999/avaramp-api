import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

/**
 * 029: Per-order custodial deposit wallets on the Avalanche C-Chain.
 *
 * Each sell/withdrawal order gets a unique Ethereum-compatible EOA (0x) deposit
 * address. The private key is stored AES-256-GCM encrypted at rest (see
 * custodialCipherService). Swept-bookkeeping tracks how far each address has
 * been drained for native AVAX and its USDT sweep tx hash.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).createTable('custodial_wallets', (t) => {
    t.increments('id').primary();
    t.integer('order_id').notNullable().unsigned();
    t.integer('index').notNullable().unsigned();
    t.string('address', 64).notNullable();
    t.jsonb('encrypted_private_key').notNullable();
    t.string('swept_navax_block', 80).nullable();
    t.string('swept_usdt_txhash', 256).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.unique(['order_id']);
    t.index(['address']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).dropTableIfExists('custodial_wallets');
}