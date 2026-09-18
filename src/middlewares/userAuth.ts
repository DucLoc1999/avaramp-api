import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt } from '../utils/jwt';
import { createErrorReply } from './errorHandler';

export async function userAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = process.env.USER_JWT_SECRET;
  if (!secret) {
    return createErrorReply(reply, 'AUTH_NOT_CONFIGURED', 'User auth not configured', req.id);
  }

  const auth = req.headers.authorization;
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) {
    return createErrorReply(reply, 'UNAUTHORIZED', 'Unauthorized', req.id);
  }

  try {
    const payload = verifyJwt(token, secret);
    const id = typeof payload.sub === 'number' ? payload.sub : Number(payload.sub);
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const kyc_status = typeof payload.kyc_status === 'string' ? payload.kyc_status : 'none';
    if (!Number.isFinite(id) || !email) throw new Error('Invalid token');
    req.user = { id, email, kyc_status };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    return createErrorReply(reply, 'UNAUTHORIZED', message, req.id);
  }
}
