import crypto from 'crypto';

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlJson(obj: unknown): string {
  return base64url(JSON.stringify(obj));
}

function decodeBase64url(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(fullPayload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid token'), { statusCode: 401 });

  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const actualSig = decodeBase64url(s);

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
  }

  const payloadJson = decodeBase64url(p).toString('utf8');
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
  if (exp !== undefined && now >= exp) throw Object.assign(new Error('Token expired'), { statusCode: 401 });

  return payload;
}

