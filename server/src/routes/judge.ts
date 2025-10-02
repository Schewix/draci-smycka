import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { HttpError } from '../utils/errors.js';
import { handleSupabaseMaybe } from '../utils/supabase.js';
import { insertAuditLog } from '../utils/audit.js';
import type { AttemptRow, CompetitorRow } from '../types.js';

const MAX_TIME_CENTISECONDS = 20 * 60 * 100; // 20 minutes

const lookupQuerySchema = z.object({
  token: z.string().min(1),
});

const attemptPayloadSchema = z.object({
  competitorId: z.string().uuid(),
  nodeId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(2),
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('time'),
      centiseconds: z.number().int().min(0).max(MAX_TIME_CENTISECONDS),
    }),
    z.object({
      kind: z.literal('fault'),
      faultCode: z.string().min(1).max(20),
    }),
  ]),
  note: z.string().max(500).optional(),
});

function ensureCompetitorAllowed(competitor: CompetitorRow, allowedCategories: string[]) {
  if (!allowedCategories.includes(competitor.category_code)) {
    throw new HttpError(403, 'Competitor category not allowed');
  }
}

async function loadCompetitorByToken(eventId: string, token: string) {
  const competitor = handleSupabaseMaybe<CompetitorRow>(
    await supabase
      .from('competitors')
      .select('id, event_id, category_code, display_name, club, start_number, qr_token')
      .eq('event_id', eventId)
      .eq('qr_token', token)
      .maybeSingle(),
    'Competitor not found',
  );

  if (competitor) {
    return competitor;
  }

  const qrToken = handleSupabaseMaybe<{ competitor_id: string }>(
    await supabase
      .from('qr_tokens')
      .select('competitor_id')
      .eq('event_id', eventId)
      .eq('token', token)
      .is('revoked_at', null)
      .maybeSingle(),
    'Competitor not found',
  );

  if (!qrToken) {
    throw new HttpError(404, 'Competitor not found');
  }

  const match = handleSupabaseMaybe<CompetitorRow>(
    await supabase
      .from('competitors')
      .select('id, event_id, category_code, display_name, club, start_number, qr_token')
      .eq('id', qrToken.competitor_id)
      .maybeSingle(),
    'Competitor not found',
  );

  if (!match) {
    throw new HttpError(404, 'Competitor not found');
  }

  return match;
}

async function loadAttempts(competitorId: string, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return [] as AttemptRow[];
  }

  const response = await supabase
    .from('attempts')
    .select(
      'id, event_id, competitor_id, node_id, attempt_number, result_kind, centiseconds, fault_code, note, locked, recorded_by, recorded_role, created_at, updated_at',
    )
    .eq('competitor_id', competitorId)
    .in('node_id', nodeIds)
    .order('attempt_number', { ascending: true });

  if (response.error) {
    throw new HttpError(500, 'Failed to load attempts', response.error);
  }

  return response.data ?? [];
}

const router = Router();

router.use(authenticate);
router.use(requireRole('judge'));

router.get('/competitors/lookup', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const { token } = lookupQuerySchema.parse(req.query);

    const competitor = await loadCompetitorByToken(req.auth.eventId, token.trim());

    ensureCompetitorAllowed(competitor, req.auth.allowedCategories ?? []);

    const nodeIds = req.auth.nodeIds ?? [];
    if (nodeIds.length === 0) {
      throw new HttpError(403, 'Judge has no assigned nodes');
    }

    const attempts = await loadAttempts(competitor.id, nodeIds);

    res.json({
      competitor: {
        id: competitor.id,
        displayName: competitor.display_name,
        categoryCode: competitor.category_code,
        club: competitor.club,
        startNumber: competitor.start_number,
      },
      attempts,
      nodeIds,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/attempts', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const payload = attemptPayloadSchema.parse(req.body ?? {});

    const nodeIds = req.auth.nodeIds ?? [];
    if (!nodeIds.includes(payload.nodeId)) {
      throw new HttpError(403, 'Node is not assigned to judge');
    }

    const competitor = handleSupabaseMaybe<CompetitorRow>(
      await supabase
        .from('competitors')
        .select('id, event_id, category_code')
        .eq('id', payload.competitorId)
        .eq('event_id', req.auth.eventId)
        .maybeSingle(),
      'Competitor not found',
    );

    if (!competitor) {
      throw new HttpError(404, 'Competitor not found');
    }

    ensureCompetitorAllowed(competitor, req.auth.allowedCategories ?? []);

    const existing = await loadAttempts(payload.competitorId, [payload.nodeId]);

    const attempt1 = existing.find((attempt) => attempt.attempt_number === 1);
    const attempt2 = existing.find((attempt) => attempt.attempt_number === 2);

    if (payload.attemptNumber === 1) {
      if (attempt1) {
        throw new HttpError(409, 'Attempt 1 already exists');
      }
    } else {
      if (!attempt1) {
        throw new HttpError(409, 'Attempt 1 must be recorded first');
      }
      if (!attempt1.locked) {
        throw new HttpError(409, 'Attempt 1 is not locked yet');
      }
      if (attempt2) {
        throw new HttpError(409, 'Attempt 2 already exists');
      }
    }

    const insertPayload: Record<string, unknown> = {
      event_id: req.auth.eventId,
      competitor_id: payload.competitorId,
      node_id: payload.nodeId,
      attempt_number: payload.attemptNumber,
      result_kind: payload.result.kind,
      locked: true,
      recorded_by: req.auth.userId,
      recorded_role: req.auth.role,
      note: payload.note ?? null,
    };

    if (payload.result.kind === 'time') {
      insertPayload.centiseconds = payload.result.centiseconds;
      insertPayload.fault_code = null;
    } else {
      insertPayload.centiseconds = null;
      insertPayload.fault_code = payload.result.faultCode;
    }

    const insert = await supabase.from('attempts').insert(insertPayload).select().maybeSingle();

    if (insert.error) {
      if (insert.error.code === '23505') {
        throw new HttpError(409, 'Attempt already exists', insert.error);
      }
      throw new HttpError(500, 'Failed to insert attempt', insert.error);
    }

    const createdAttempt = insert.data;
    if (!createdAttempt) {
      throw new HttpError(500, 'Attempt creation failed');
    }

    // Ensure attempt 1 is locked after insert.
    if (payload.attemptNumber === 1) {
      const lockUpdate = await supabase
        .from('attempts')
        .update({ locked: true })
        .eq('competitor_id', payload.competitorId)
        .eq('node_id', payload.nodeId)
        .eq('attempt_number', 1);

      if (lockUpdate.error) {
        throw new HttpError(500, 'Failed to lock attempt 1', lockUpdate.error);
      }
    }

    await insertAuditLog({
      eventId: req.auth.eventId,
      attemptId: createdAttempt.id,
      competitorId: payload.competitorId,
      nodeId: payload.nodeId,
      attemptNumber: payload.attemptNumber,
      action: 'attempt_created',
      newValue: createdAttempt,
      userId: req.auth.userId,
      role: req.auth.role,
      ip: req.ip ?? null,
    });

    res.status(201).json({ attempt: createdAttempt });
  } catch (error) {
    next(error);
  }
});

export default router;
