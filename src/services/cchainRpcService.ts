import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseAbi,
  type Account,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Address,
} from 'viem';
import { avalanche, avalancheFuji } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { loadCchainConfig } from '../config/cchain';

const USDT_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function nonces(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

let chain: Chain;
function resolveChain(chainId: number): Chain {
  if (chainId === 43114) return avalanche;
  if (chainId === 43113) return avalancheFuji;
  return { id: chainId, name: `Avalanche-${chainId}`, nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, rpcUrls: { default: { http: [] } } };
}

let publicClient: PublicClient | null = null;
let rpcBaseUrl: string;

export function getCchainChain(env: NodeJS.ProcessEnv = process.env): Chain {
  const cfg = loadCchainConfig(env);
  return resolveChain(cfg.chainId);
}

export function getPublicClient(env: NodeJS.ProcessEnv = process.env): PublicClient {
  const cfg = loadCchainConfig(env);
  if (!publicClient || rpcBaseUrl !== cfg.rpcBaseUrl) {
    publicClient = createPublicClient({ chain: resolveChain(cfg.chainId), transport: http(cfg.rpcBaseUrl) });
    rpcBaseUrl = cfg.rpcBaseUrl;
  }
  return publicClient;
}

/** Read-only wallet client for the Master Wallet (used for permit+transferFrom gas payer). */
export function getMasterWalletClient(env: NodeJS.ProcessEnv = process.env): WalletClient {
  const cfg = loadCchainConfig(env);
  if (!cfg.masterWalletPrivateKey) {
    throw new Error('MASTER_WALLET_PRIVATE_KEY is not configured');
  }
  const account = privateKeyToAccount(cfg.masterWalletPrivateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: resolveChain(cfg.chainId),
    transport: http(cfg.rpcBaseUrl),
  });
}

/** Wallet client bound to an arbitrary viem account (e.g. the C-Chain payout KMS account). */
export function getWalletClientForAccount(
  account: Account,
  env: NodeJS.ProcessEnv = process.env
): WalletClient {
  const cfg = loadCchainConfig(env);
  return createWalletClient({
    account,
    chain: resolveChain(cfg.chainId),
    transport: http(cfg.rpcBaseUrl),
  });
}

export function getNativeUsdtContract(env: NodeJS.ProcessEnv = process.env): Address {
  return loadCchainConfig(env).nativeUsdtAddress;
}

export async function getBalance(address: Address, env: NodeJS.ProcessEnv = process.env): Promise<bigint> {
  return getPublicClient(env).getBalance({ address: getAddress(address) });
}

export async function getBlockNumber(env: NodeJS.ProcessEnv = process.env): Promise<bigint> {
  return getPublicClient(env).getBlockNumber();
}

export async function getConfirmations(
  txHash: `0x${string}`,
  env: NodeJS.ProcessEnv = process.env
): Promise<bigint> {
  return getPublicClient(env).getTransactionConfirmations({ hash: txHash });
}

export async function getUsdtBalance(
  address: Address,
  env: NodeJS.ProcessEnv = process.env
): Promise<bigint> {
  return getPublicClient(env).readContract({
    address: getNativeUsdtContract(env),
    abi: USDT_ABI,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

export interface UsdtTransferLog {
  txHash: `0x${string}`;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  blockHash: string;
}

/** ERC-20 `Transfer` logs from the native USDT contract within a block range. */
export async function getUsdtTransferLogs(
  predicate: (to: string) => boolean,
  fromBlock: bigint,
  toBlock: bigint,
  env: NodeJS.ProcessEnv = process.env
): Promise<UsdtTransferLog[]> {
  const client = getPublicClient(env);
  const logs = await client.getLogs({
    address: getNativeUsdtContract(env),
    event: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0] as never,
    fromBlock,
    toBlock,
  });

  return (logs as unknown as Array<Record<string, unknown>>).flatMap((raw: any) => {
    const args = raw.args as { from?: string; to?: string; value?: bigint };
    if (!args?.to || !predicate(getAddress(args.to))) return [];
    return {
      txHash: raw.transactionHash as `0x${string}`,
      logIndex: raw.logIndex as number,
      from: args.from as string,
      to: getAddress(args.to),
      value: args.value as bigint,
      blockNumber: BigInt(raw.blockNumber as string | number),
      blockHash: raw.blockHash as string,
    };
  });
}

export { USDT_ABI, parseAbi };
// Re-exported for downstream consumers convenience.
export { getAddress };