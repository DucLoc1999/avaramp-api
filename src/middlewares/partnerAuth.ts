import type { FastifyRequest, FastifyReply } from 'fastify';
import { createErrorReply } from './errorHandler';
import { findPartnerByKey, toPartnerAuthContext } from '../services/partnerService';

export async function partnerAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers['partner-app-key'];

  if (!header || Array.isArray(header)) {
    return createErrorReply(reply, 'UNAUTHORIZED', 'Invalid partner key', req.id);
  }

  const partner = await findPartnerByKey(header);
  if (!partner) {
    return createErrorReply(reply, 'UNAUTHORIZED', 'Invalid partner key', req.id);
  }

  req.partner = toPartnerAuthContext(partner);
}
