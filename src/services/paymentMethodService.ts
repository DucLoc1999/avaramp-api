import db from '../db';

export interface PaymentMethod {
  id: number;
  user_id: number;
  type: 'BANK' | 'CRYPTO';
  wallet_address: string | null;
  bank_id: number | null;
  full_name: string | null;
  bank_account: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreatePaymentMethodInput {
  type: 'BANK' | 'CRYPTO';
  wallet_address?: string | null;
  bank_id?: number | null;
  full_name?: string | null;
  bank_account?: string | null;
}

export interface UpdatePaymentMethodInput {
  wallet_address?: string | null;
  bank_id?: number | null;
  full_name?: string | null;
  bank_account?: string | null;
}

const table = 'payment_methods';

export async function listByUserId(userId: number): Promise<PaymentMethod[]> {
  return db(table).where({ user_id: userId }).orderBy('created_at', 'desc');
}

export async function findById(id: number): Promise<PaymentMethod | undefined> {
  return db(table).where({ id }).first();
}

export async function create(userId: number, data: CreatePaymentMethodInput): Promise<PaymentMethod> {
  const [row] = await db(table).insert({ user_id: userId, ...data }).returning('*');
  return row;
}

export async function update(id: number, data: UpdatePaymentMethodInput): Promise<PaymentMethod> {
  const [row] = await db(table).where({ id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
  return row;
}

export async function remove(id: number): Promise<void> {
  await db(table).where({ id }).del();
}
