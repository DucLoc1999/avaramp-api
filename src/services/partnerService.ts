import crypto from 'crypto';
import db from '../db';

export interface PartnerAuthContext {
  id: string;
  name: string;
  fee_buy: number;
  fee_sell: number;
}

export interface PartnerRecord extends PartnerAuthContext {
  key: string;
  active: boolean;
  creator: number | null;
  created_at: string | Date;
  updated_at?: string | Date | null;
}

export interface CreatePartnerInput {
  name: string;
  fee_buy: number;
  fee_sell: number;
  active?: boolean;
  creator?: number | null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePartner(row: Record<string, unknown>): PartnerRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    key: String(row.key ?? ''),
    fee_buy: toNumber(row.fee_buy),
    fee_sell: toNumber(row.fee_sell),
    active: toBoolean(row.active),
    creator: row.creator != null ? Number(row.creator) : null,
    created_at: row.created_at instanceof Date ? row.created_at : String(row.created_at ?? ''),
    updated_at: row.updated_at instanceof Date || row.updated_at === null || row.updated_at === undefined
      ? row.updated_at ?? null
      : String(row.updated_at),
  };
}

export function toPartnerAuthContext(partner: PartnerRecord): PartnerAuthContext {
  return {
    id: partner.id,
    name: partner.name,
    fee_buy: partner.fee_buy,
    fee_sell: partner.fee_sell,
  };
}

export async function listPartners(): Promise<PartnerRecord[]> {
  const rows = await db('partners').select('*').orderBy('created_at', 'desc');
  return rows.map((row: Record<string, unknown>) => normalizePartner(row));
}

export async function findPartnerById(id: string): Promise<PartnerRecord | undefined> {
  const row = await db('partners').where({ id }).first();
  return row ? normalizePartner(row as Record<string, unknown>) : undefined;
}

export async function findPartnerByKey(key: string, includeInactive = false): Promise<PartnerRecord | undefined> {
  let query = db('partners').where({ key });
  if (!includeInactive) {
    query = query.andWhere({ active: true });
  }
  const row = await query.first();
  return row ? normalizePartner(row as Record<string, unknown>) : undefined;
}

export async function createPartner(input: CreatePartnerInput): Promise<PartnerRecord> {
  const id = crypto.randomUUID();
  const key = crypto.randomBytes(32).toString('hex');

  await db('partners').insert({
    id,
    name: input.name.trim(),
    key,
    fee_buy: input.fee_buy,
    fee_sell: input.fee_sell,
    active: input.active ?? true,
    creator: input.creator ?? null,
  });

  const row = await findPartnerById(id);
  if (!row) {
    throw new Error('Failed to create partner');
  }
  return row;
}

export interface UpdatePartnerInput {
  name?: string;
  fee_buy?: number;
  fee_sell?: number;
  active?: boolean;
}

export async function updatePartner(id: string, input: UpdatePartnerInput): Promise<PartnerRecord | undefined> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.fee_buy !== undefined) patch.fee_buy = input.fee_buy;
  if (input.fee_sell !== undefined) patch.fee_sell = input.fee_sell;
  if (input.active !== undefined) patch.active = input.active;

  if (Object.keys(patch).length === 0) return findPartnerById(id);

  await db('partners').where({ id }).update(patch);
  return findPartnerById(id);
}

export async function ensureBootstrapPartner(): Promise<void> {
  const legacyKey = process.env.PARTNER_APP_KEY;
  if (!legacyKey) {
    return;
  }

  const existing = await db('partners').where({ key: legacyKey }).first();
  if (existing) {
    return;
  }

  await db('partners').insert({
    id: crypto.randomUUID(),
    name: process.env.PARTNER_BOOTSTRAP_NAME ?? 'default-partner',
    key: legacyKey,
    fee_buy: Number(process.env.PARTNER_BOOTSTRAP_FEE_BUY ?? 0),
    fee_sell: Number(process.env.PARTNER_BOOTSTRAP_FEE_SELL ?? 0),
    active: true,
  });
}
