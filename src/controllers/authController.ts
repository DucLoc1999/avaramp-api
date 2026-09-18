import type { FastifyRequest, FastifyReply } from 'fastify';
import { createErrorReply } from '../middlewares/errorHandler';
import { verifyGoogleIdToken } from '../services/googleAuthService';
import * as userService from '../services/userService';
import { signJwt } from '../utils/jwt';

const USER_JWT_EXPIRES_SEC = Number(process.env.USER_JWT_EXPIRES_SEC) || 86400;

export async function handleGoogleLogin(
  req: FastifyRequest<{ Body: { id_token: string; client?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id_token, client } = req.body;
  if (!id_token) {
    return createErrorReply(reply, 'VALIDATION_ERROR', 'id_token is required', req.id);
  }

  const secret = process.env.USER_JWT_SECRET;
  if (!secret) {
    return createErrorReply(reply, 'AUTH_NOT_CONFIGURED', 'User auth not configured', req.id);
  }

  let googleUser: { sub: string; email: string; name: string; picture?: string };
  try {
    googleUser = await verifyGoogleIdToken(id_token, client);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Google token';
    return createErrorReply(reply, 'UNAUTHORIZED', message, req.id);
  }

  let user = await userService.findByGoogleId(googleUser.sub);

  if (!user) {
    user = await userService.findByEmail(googleUser.email);
    if (user) {
      // Link existing account to Google
      user = await userService.updateGoogleId(user.id, googleUser.sub);
    } else {
      // Create new user from Google profile
      user = await userService.createFromGoogle({
        google_id: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
      });
    }
  }

  if (!user) {
    return createErrorReply(reply, 'INTERNAL_ERROR', 'Failed to resolve user', req.id);
  }

  const kyc_status = (user as any).kyc_status ?? 'none';
  const token = signJwt(
    { sub: user.id, email: user.email ?? '', kyc_status },
    secret,
    USER_JWT_EXPIRES_SEC,
  );

  return reply.send({
    success: true,
    data: {
      access_token: token,
      expires_in: USER_JWT_EXPIRES_SEC,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        kyc_status,
      },
    },
  });
}
