import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

export async function hashPassword(password: string): Promise<{ saltHex: string; hashHex: string }> {
  const salt = crypto.randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return { saltHex: salt.toString('hex'), hashHex: key.toString('hex') };
}

export async function verifyPassword(params: {
  password: string;
  saltHex: string;
  hashHex: string;
}): Promise<boolean> {
  const salt = Buffer.from(params.saltHex, 'hex');
  const expected = Buffer.from(params.hashHex, 'hex');
  const actual = (await scryptAsync(params.password, salt, expected.length)) as Buffer;
  return crypto.timingSafeEqual(expected, actual);
}

