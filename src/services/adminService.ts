import db from '../db';
import { hashPassword, verifyPassword } from '../utils/password';

export type AdminRow = {
  id: number;
  email: string;
  password_salt: string;
  password_hash: string;
};

export async function findAdminByEmail(email: string): Promise<AdminRow | undefined> {
  return db('admins').where({ email }).first();
}

export async function createAdmin(email: string, password: string): Promise<number> {
  const { saltHex, hashHex } = await hashPassword(password);
  const rows = await db('admins')
    .insert({ email, password_salt: saltHex, password_hash: hashHex })
    .onConflict('email')
    .ignore()
    .returning<{ id: number }[]>('id');

  if (rows.length > 0) return rows[0]!.id;

  const existing = await db('admins').where({ email }).first<{ id: number }>('id');
  if (!existing) throw new Error('Failed to create admin');
  return existing.id;
}

export async function verifyAdminCredentials(email: string, password: string): Promise<{ id: number; email: string } | null> {
  const row = await findAdminByEmail(email);
  if (!row) return null;
  const ok = await verifyPassword({ password, saltHex: row.password_salt, hashHex: row.password_hash });
  if (!ok) return null;
  return { id: row.id, email: row.email };
}

export async function changeAdminPassword(email: string, newPassword: string): Promise<void> {
  const { saltHex, hashHex } = await hashPassword(newPassword);
  await db('admins').where({ email }).update({ password_salt: saltHex, password_hash: hashHex });
}

export async function ensureBootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;

  const existing = await findAdminByEmail(email);
  if (existing) return;

  await createAdmin(email, password);
}
