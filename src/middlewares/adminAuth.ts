import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt } from '../utils/jwt';

export async function adminAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    reply.code(503).send({ success: false, error: 'Admin auth not configured' });
    return;
  }

  const auth = req.headers.authorization;
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) {
    reply.code(401).send({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const payload = verifyJwt(token, secret);
    const id = typeof payload.sub === 'number' ? payload.sub : Number(payload.sub);
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!Number.isFinite(id) || !email) throw new Error('Invalid token');
    req.admin = { id, email };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    reply.code(401).send({ success: false, error: message });
  }
}

