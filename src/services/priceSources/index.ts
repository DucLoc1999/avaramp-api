import { getConfig, getTokenSideConfigFromDb } from '../configService';
import { binanceSource } from './binanceSource';
import { coingeckoSource } from './coingeckoSource';

export interface PriceSourceResult {
  buy: number;
  sell: number;
  cached: boolean;
}

export type PriceSourceFn = (asset: string, config: Record<string, unknown>) => Promise<PriceSourceResult>;

const registry: Record<string, PriceSourceFn> = {
  binance: binanceSource,
  coingecko: coingeckoSource,
};

export const AVAILABLE_PRICE_SOURCES: string[] = Object.keys(registry);

export function registerPriceSource(name: string, fn: PriceSourceFn): void {
  registry[name] = fn;
}

async function getTokenSource(asset: string): Promise<string | undefined> {
  const buyConfig = await getTokenSideConfigFromDb(asset, 'buy');
  if (buyConfig?.source && registry[buyConfig.source]) return buyConfig.source;

  const sellConfig = await getTokenSideConfigFromDb(asset, 'sell');
  if (sellConfig?.source && registry[sellConfig.source]) return sellConfig.source;

  const configuredSource = buyConfig?.source ?? sellConfig?.source;
  if (configuredSource) {
    console.warn('[PriceSources] Unsupported token source "' + configuredSource + '" for asset="' + asset + '", falling back to global source');
  }

  return undefined;
}

async function getSourceName(asset?: string): Promise<string> {
  if (asset) {
    const tokenSource = await getTokenSource(asset);
    if (tokenSource) return tokenSource;
  }

  const dbVal = await getConfig('price_source');
  if (dbVal && registry[dbVal]) return dbVal;
  const envVal = process.env.PRICE_SOURCE;
  if (envVal && registry[envVal]) return envVal;
  return 'binance';
}

async function getSourceConfig(source: string): Promise<Record<string, unknown>> {
  const raw = await getConfig('rate_' + source + '_source');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getPrices(asset: string): Promise<PriceSourceResult> {
  const source = await getSourceName(asset);
  const config = await getSourceConfig(source);
  const fn = registry[source];
  if (!fn) {
    throw new Error('Unsupported price source: ' + source);
  }
  return fn(asset, config);
}
