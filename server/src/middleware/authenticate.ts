import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../tokens.js';
import { HttpError } from '../utils/errors.js';

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Missing authorization token'));
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next(new HttpError(401, 'Missing authorization token'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      role: payload.role,
      eventId: payload.eventId,
      sessionId: payload.sessionId,
      nodeIds: payload.nodeIds ?? [],
      allowedCategories: payload.allowedCategories ?? [],
    };
    return next();
  } catch (error) {
    return next(new HttpError(401, 'Invalid or expired token', error));
  }
}
