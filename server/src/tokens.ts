import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from './env.js';
import type { UserRole } from './types.js';

export interface TokenPayload {
  sub: string; // user id
  eventId: string;
  role: UserRole;
  sessionId: string;
  nodeIds?: string[];
  allowedCategories?: string[];
  type: 'access' | 'refresh';
}

export function createAccessToken(payload: Omit<TokenPayload, 'type'>) {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function createRefreshToken(payload: Omit<TokenPayload, 'type'>) {
  return jwt.sign({ ...payload, type: 'refresh' }, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as TokenPayload;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashRefreshToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
