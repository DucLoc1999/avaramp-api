import db from '../db';

export interface User {
  id: number;
  id_number: string | null;
  name: string;
  dob: Date | string | null;
  sex: string | null;
  nationality: string | null;
  home: string | null;
  address: string | null;
  doe: Date | string | null;
  phone: string | null;
  email: string | null;
  kyc_image_front: string | null;
  kyc_image_back: string | null;
  google_id: string | null;
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected';
  kyc_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateUserInput {
  id_number: string;
  name: string;
  dob: Date;
  sex?: string | null;
  nationality?: string | null;
  home?: string | null;
  address?: string | null;
  doe?: Date | null;
  phone?: string | null;
  email?: string | null;
  kyc_image_front?: string | null;
  kyc_image_back?: string | null;
}

export interface CreateGoogleUserInput {
  google_id: string;
  email: string;
  name: string;
}

const table = 'users';

export async function findById(id: number): Promise<User | undefined> {
  return db(table).where({ id }).first();
}

export async function findByIdNumber(idNumber: string): Promise<User | undefined> {
  return db(table).where({ id_number: idNumber }).first();
}

export async function findByPhone(phone: string): Promise<User | undefined> {
  return db(table).where({ phone }).first();
}

export async function findByEmail(email: string): Promise<User | undefined> {
  return db(table).where({ email }).first();
}

export async function findByQuery(query: {
  id?: number;
  phone?: string;
  email?: string;
  id_number?: string;
}): Promise<User | undefined> {
  if (query.id) return findById(query.id);
  if (query.id_number) return findByIdNumber(query.id_number);
  if (query.phone) return findByPhone(query.phone);
  if (query.email) return findByEmail(query.email);
  return undefined;
}

export async function create(data: CreateUserInput): Promise<User> {
  const [row] = await db(table).insert(data).returning('*');
  return row;
}

export async function findByGoogleId(googleId: string): Promise<User | undefined> {
  return db(table).where({ google_id: googleId }).first();
}

export async function updateGoogleId(userId: number, googleId: string): Promise<User> {
  const [row] = await db(table).where({ id: userId }).update({ google_id: googleId }).returning('*');
  return row;
}

export async function createFromGoogle(data: CreateGoogleUserInput): Promise<User> {
  const [row] = await db(table).insert({
    google_id: data.google_id,
    email: data.email,
    name: data.name,
    kyc_status: 'none',
  }).returning('*');
  return row;
}

export async function updateKycStatus(
  userId: number,
  status: 'none' | 'pending' | 'approved' | 'rejected',
  verifiedAt?: Date | null,
): Promise<void> {
  await db(table).where({ id: userId }).update({
    kyc_status: status,
    kyc_verified_at: verifiedAt ?? null,
  });
}

export async function updateKycData(
  userId: number,
  data: {
    id_number?: string;
    name?: string;
    dob?: Date | null;
    sex?: string | null;
    nationality?: string | null;
    home?: string | null;
    address?: string | null;
    doe?: Date | null;
    kyc_image_front?: string | null;
    kyc_image_back?: string | null;
    kyc_status?: 'none' | 'pending' | 'approved' | 'rejected';
    kyc_verified_at?: Date | null;
  },
): Promise<User> {
  const [row] = await db(table).where({ id: userId }).update(data).returning('*');
  return row;
}
