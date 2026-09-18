export interface CchainDepositEvent {
  depositId: number;
  address: string;
  asset: 'avax' | 'usdt';
  amount: string;
  orderId?: number | null;
  txHash?: string | null;
}