import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorReply } from './errorHandler';

export async function kycCheck(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user || req.user.kyc_status !== 'approved') {
    return createErrorReply(reply, 'KYC_REQUIRED', 'KYC verification required to perform withdrawals', req.id);
  }
}
