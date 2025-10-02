import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/errors.js';
import type { UserRole } from '../types.js';

export function requireRole(...roles: UserRole[]) {
  const allowed = new Set(roles);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new HttpError(401, 'Unauthorized'));
    }
    if (!allowed.has(req.auth.role)) {
      return next(new HttpError(403, 'Forbidden'));
    }
    return next();
  };
}
