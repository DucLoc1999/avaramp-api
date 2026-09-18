import type { Knex } from 'knex';

const schema = process.env.DB_SCHEMA ?? 'avaramp';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema(schema).table('config', (t) => {
    t.index('key');
  });

  await knex('config').insert([
    {
      key: 'price_source',
      value: 'binance',
      description: 'Price source: binance or coingecko',
    },
    {
      key: 'rate_binance_source',
      value: JSON.stringify({
        rows: 5,
        fiat: 'VND',
        merchantCheck: false,
        publisherType: null,
        transAmount: null,
        cache_ttl_ms: 30000,
      }),
      description: 'Binance source config as JSON',
    },
    {
      key: 'rate_coingecko_source',
      value: JSON.stringify({
        api_key: null,
        spread: 100,
        cache_ttl_ms: 30000,
        asset_map: {
          XLM: 'stellar',
          USDC: 'usd-coin',
        },
      }),
      description: 'CoinGecko source config as JSON',
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex('config').whereIn('key', ['price_source', 'rate_binance_source', 'rate_coingecko_source']).delete();
}