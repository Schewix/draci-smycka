import type { NextFunction, Request, Response } from 'express';
import { isHttpError } from '../utils/errors.js';

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isHttpError(error)) {
    res.status(error.status).json({
      error: error.message,
      details: error.details ?? undefined,
    });
    return;
  }

  console.error('Unhandled error', error);
  res.status(500).json({ error: 'Internal server error' });
}
