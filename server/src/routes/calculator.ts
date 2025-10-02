import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { HttpError } from '../utils/errors.js';
import { ensureRows, handleSupabaseMaybe } from '../utils/supabase.js';
import { insertAuditLog } from '../utils/audit.js';
import type { AttemptRow, CompetitorRow, NodeRow } from '../types.js';

const attemptUpdateSchema = z.object({
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('time'),
      centiseconds: z.number().int().min(0).max(20 * 60 * 100),
    }),
    z.object({
      kind: z.literal('fault'),
      faultCode: z.string().min(1).max(20),
    }),
  ]),
  note: z.string().max(500).optional(),
});

const tokenLookupSchema = z.object({
  token: z.string().min(1),
});

function groupAttemptsByNode(attempts: AttemptRow[]) {
  const map = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    const list = map.get(attempt.node_id) ?? [];
    list.push(attempt);
    map.set(attempt.node_id, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.attempt_number - b.attempt_number);
  }
  return map;
}

function computeBest(attempts: AttemptRow[]) {
  const timeAttempts = attempts.filter((attempt) => attempt.result_kind === 'time' && attempt.centiseconds !== null);
  if (timeAttempts.length === 0) {
    const hasFault = attempts.some((attempt) => attempt.result_kind === 'fault');
    return {
      status: hasFault ? 'fault' : attempts.length > 0 ? 'incomplete' : 'missing',
      bestCentiseconds: null as number | null,
    };
  }
  const best = timeAttempts.reduce((min, attempt) => {
    const value = attempt.centiseconds ?? Number.POSITIVE_INFINITY;
    return value < (min.centiseconds ?? Number.POSITIVE_INFINITY) ? attempt : min;
  }, timeAttempts[0]);
  return {
    status: 'time',
    bestCentiseconds: best.centiseconds,
    attemptId: best.id,
  };
}

const router = Router();

router.use(authenticate);
router.use(requireRole('calculator', 'admin'));

router.get('/competitors/lookup', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const { token } = tokenLookupSchema.parse(req.query);

    const competitor = handleSupabaseMaybe<CompetitorRow>(
      await supabase
        .from('competitors')
        .select('id, event_id, category_code, display_name, club, start_number, qr_token')
        .eq('event_id', req.auth.eventId)
        .eq('qr_token', token)
        .maybeSingle(),
      'Competitor not found',
    );

    if (!competitor) {
      throw new HttpError(404, 'Competitor not found');
    }

    res.json({
      competitor: {
        id: competitor.id,
        displayName: competitor.display_name,
        categoryCode: competitor.category_code,
        club: competitor.club,
        startNumber: competitor.start_number,
        qrToken: competitor.qr_token,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/competitors/:competitorId', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const competitorId = z.string().uuid().parse(req.params.competitorId);

    const competitor = handleSupabaseMaybe<CompetitorRow>(
      await supabase
        .from('competitors')
        .select('id, event_id, category_code, display_name, club, start_number, qr_token')
        .eq('id', competitorId)
        .maybeSingle(),
      'Competitor not found',
    );

    if (!competitor || competitor.event_id !== req.auth.eventId) {
      throw new HttpError(404, 'Competitor not found');
    }

    const nodes = ensureRows<NodeRow>(
      await supabase
        .from('nodes')
        .select('id, event_id, code, name, sequence, is_relay, counts_to_overall')
        .eq('event_id', req.auth.eventId)
        .order('sequence', { ascending: true }),
      'Failed to load nodes',
    );

    const attemptsResponse = await supabase
      .from('attempts')
      .select(
        'id, event_id, competitor_id, node_id, attempt_number, result_kind, centiseconds, fault_code, note, locked, recorded_by, recorded_role, created_at, updated_at',
      )
      .eq('competitor_id', competitorId)
      .order('node_id', { ascending: true })
      .order('attempt_number', { ascending: true });

    if (attemptsResponse.error) {
      throw new HttpError(500, 'Failed to load attempts', attemptsResponse.error);
    }

    const attempts = attemptsResponse.data ?? [];
    const attemptsByNode = groupAttemptsByNode(attempts);
    const bestByNode: Record<string, ReturnType<typeof computeBest>> = {};

    for (const node of nodes) {
      const list = attemptsByNode.get(node.id) ?? [];
      bestByNode[node.id] = computeBest(list);
    }

    res.json({
      competitor: {
        id: competitor.id,
        displayName: competitor.display_name,
        categoryCode: competitor.category_code,
        club: competitor.club,
        startNumber: competitor.start_number,
        qrToken: competitor.qr_token,
      },
      nodes,
      attemptsByNode: Object.fromEntries(Array.from(attemptsByNode.entries())),
      bestByNode,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/attempts/:attemptId', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const attemptId = z.string().uuid().parse(req.params.attemptId);
    const payload = attemptUpdateSchema.parse(req.body ?? {});

    const attempt = handleSupabaseMaybe<AttemptRow>(
      await supabase
        .from('attempts')
        .select(
          'id, event_id, competitor_id, node_id, attempt_number, result_kind, centiseconds, fault_code, note, locked, recorded_by, recorded_role',
        )
        .eq('id', attemptId)
        .maybeSingle(),
      'Attempt not found',
    );

    if (!attempt || attempt.event_id !== req.auth.eventId) {
      throw new HttpError(404, 'Attempt not found');
    }

    const updatePayload: Record<string, unknown> = {
      result_kind: payload.result.kind,
      locked: true,
      note: payload.note ?? null,
    };

    if (payload.result.kind === 'time') {
      updatePayload.centiseconds = payload.result.centiseconds;
      updatePayload.fault_code = null;
    } else {
      updatePayload.centiseconds = null;
      updatePayload.fault_code = payload.result.faultCode;
    }

    const update = await supabase
      .from('attempts')
      .update(updatePayload)
      .eq('id', attemptId)
      .select()
      .maybeSingle();

    if (update.error) {
      throw new HttpError(500, 'Failed to update attempt', update.error);
    }

    const updatedAttempt = update.data;
    if (!updatedAttempt) {
      throw new HttpError(500, 'Update did not return attempt');
    }

    await insertAuditLog({
      eventId: attempt.event_id,
      attemptId: attempt.id,
      competitorId: attempt.competitor_id,
      nodeId: attempt.node_id,
      attemptNumber: attempt.attempt_number,
      action: 'attempt_updated',
      previousValue: attempt,
      newValue: updatedAttempt,
      userId: req.auth.userId,
      role: req.auth.role,
      ip: req.ip ?? null,
    });

    res.json({ attempt: updatedAttempt });
  } catch (error) {
    next(error);
  }
});

export default router;
