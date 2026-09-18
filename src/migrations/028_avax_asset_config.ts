import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

/**
 * 028: Seed config token rows for the Avalanche X-Chain asset (default AVAX).
 *
 * - Token-side config keys are read generically by configService.getTokenConfig
 *   (`${ASSET_CODE}_${side}` JSON rows). This migration idempotently upserts the
 *   AVAX buy/sell spread, fee rate, min fee, and order amount bounds.
 * - No destructive column changes here; `orders` column semantics change (they
 *   now carry X-Chain values — `recipient` bech32 `X-avax1…`, `transaction_hash`
 *   X-Chain txID, `token_address` X-Chain asset id) but the schema is unchanged.
 * - `system_wallets` Stellar rows are DEPRECATED: the hot wallet is now derived
 *   from the GCP KMS secp256k1 key version, no address is stored in the DB. The
 *   table + any existing Stellar rows are left intact for historical/rollback.
 */
export async function up(knex: Knex): Promise<void> {
  const assetCode = process.env.ASSET_CODE || 'AVAX';

  const rows = [
    { key: `${assetCode}_buy`, spread: 50, fee_rate: 0.008, min_fee: 5000, min_order_amount: 0.01, max_order_amount: 1000, source: 'coingecko' },
    { key: `${assetCode}_sell`, spread: 50, fee_rate: 0.008, min_fee: 5000, min_order_amount: 0.01, max_order_amount: 1000, source: 'coingecko' },
  ];

  for (const row of rows) {
    const value = JSON.stringify({
      spread: row.spread,
      fee_rate: row.fee_rate,
      min_fee: row.min_fee,
      min_order_amount: row.min_order_amount,
      max_order_amount: row.max_order_amount,
      source: row.source,
    });

    const existing = await knex('config').where({ key: row.key }).first();
    if (existing) {
      await knex('config').where({ key: row.key }).update({ value });
    } else {
      await knex('config').insert({
        key: row.key,
        value,
        description: `${assetCode} ${row.source} config (Avalanche X-Chain asset)`,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const assetCode = process.env.ASSET_CODE || 'AVAX';
  await knex('config').whereIn('key', [`${assetCode}_buy`, `${assetCode}_sell`]).delete();
}