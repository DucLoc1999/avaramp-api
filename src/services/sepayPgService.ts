import { getConfig } from './configService';

export interface SepayBankInfo {
  account_number: string;
  account_holder_name: string;
  bank_name: string;
  bank_short_name: string;
}

export interface SepayOrderResult {
  bank_info: SepayBankInfo;
  qr_code_url: string;
  va_number: string;
  transfer_content: string;
  amount: number;
}

export interface SepayOrderListItem {
  id: string;
  order_code: string;
  amount: number;
  paid_amount: number;
  status: string;
  bank_name: string;
  account_number: string;
  account_holder_name: string;
  created_at: string;
  va: Array<{
    va_number: string;
    va_holder_name: string;
    amount: number;
    status: string;
    expired_at: string | null;
    paid_at: string | null;
  }>;
}

async function getBankInfo(): Promise<SepayBankInfo> {
  const [va_number, va_holder, bank_name, bank_short] = await Promise.all([
    getConfig('bank_va_number'),
    getConfig('bank_va_holder'),
    getConfig('bank_name'),
    getConfig('bank_short'),
  ]);
  const bankInfo = {
    account_number: va_number ?? process.env.SEPAY_VA_NUMBER ?? '',
    account_holder_name: va_holder ?? process.env.SEPAY_VA_HOLDER ?? '',
    bank_name: bank_name ?? process.env.SEPAY_BANK_NAME ?? '',
    bank_short_name: bank_short ?? process.env.SEPAY_BANK_SHORT ?? '',
  }
  return bankInfo;
}

export async function createSepayOrder(params: {
  payment_code: string;
  net_vnd: number;
}): Promise<SepayOrderResult> {
  const bank = await getBankInfo();
  const qr_code_url = `https://qr.sepay.vn/img?acc=${bank.account_number}&bank=${bank.bank_short_name}&amount=${params.net_vnd}&des=${encodeURIComponent(params.payment_code)}&template=qronly`;
  return {
    bank_info: bank,
    qr_code_url,
    va_number: bank.account_number,
    transfer_content: params.payment_code,
    amount: params.net_vnd,
  };
}

export async function listSepayOrders(_perPage = 20): Promise<SepayOrderListItem[]> {
  return [];
}