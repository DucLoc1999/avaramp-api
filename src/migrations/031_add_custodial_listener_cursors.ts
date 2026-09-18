import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

/**
 * 031: Persist C-Chain listener cursors per custodial wallet so deposit
 * detection survives listener restarts.
 *
 * - `last_scanned_block`: last C-Chain block scanned for USDT Transfer logs to
 *   this address. Null means "not yet scanned"; the listener falls back to a
 *   bounded lookback window.
 * - `native_baseline`: last observed native AVAX balance (wei, string). New
 *   wallets are provisioned with `0` so any incoming AVAX is detected even
 *   across restarts.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.withSchema(schema).hasTable('custodial_wallets');
  if (!hasTable) return;

  await knex.schema.withSchema(schema).alterTable('custodial_wallets', (t) => {
    t.string('last_scanned_block', 80).nullable();
    t.string('native_baseline', 80).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.withSchema(schema).hasTable('custodial_wallets');
  if (!hasTable) return;

  await knex.schema.withSchema(schema).alterTable('custodial_wallets', (t) => {
    t.dropColumn('last_scanned_block');
    t.dropColumn('native_baseline');
  });
}
