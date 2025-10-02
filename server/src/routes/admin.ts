import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { HttpError } from '../utils/errors.js';
import { ensureRows, handleSupabaseMaybe } from '../utils/supabase.js';
import { insertAuditLog } from '../utils/audit.js';
import type { CategoryRow, CompetitorRow, EventRow, NodeRow } from '../types.js';

const createCompetitorSchema = z.object({
  displayName: z.string().min(1).max(200),
  categoryCode: z.string().min(1),
  club: z.string().max(200).optional(),
  startNumber: z.number().int().nonnegative().optional(),
  birthYear: z.number().int().min(1900).max(2100).optional(),
  notes: z.string().max(500).optional(),
  generateToken: z.boolean().optional().default(false),
});

const updateCompetitorSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  categoryCode: z.string().min(1).optional(),
  club: z.string().max(200).nullable().optional(),
  startNumber: z.number().int().nonnegative().nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const issueTokenSchema = z.object({
  regenerate: z.boolean().optional().default(true),
});

async function assertCategoryExists(eventId: string, categoryCode: string) {
  const category = handleSupabaseMaybe<CategoryRow>(
    await supabase
      .from('categories')
      .select('event_id, code')
      .eq('event_id', eventId)
      .eq('code', categoryCode)
      .maybeSingle(),
    'Category not found',
  );

  if (!category) {
    throw new HttpError(404, 'Category not found');
  }
}

function generateTokenCandidate(length = 8) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(length);
  let value = '';
  for (let i = 0; i < length; i += 1) {
    const index = bytes[i] % alphabet.length;
    value += alphabet[index];
  }
  return value;
}

async function generateUniqueToken(eventId: string, length = 8) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateTokenCandidate(length);
    const existing = await supabase
      .from('qr_tokens')
      .select('id')
      .eq('event_id', eventId)
      .eq('token', candidate)
      .maybeSingle();

    if (existing.error) {
      throw new HttpError(500, 'Failed to check token uniqueness', existing.error);
    }

    if (!existing.data) {
      return candidate;
    }
  }
  throw new HttpError(500, 'Unable to generate unique token');
}

const router = Router();

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/events/:eventId/context', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const eventId = z.string().uuid().parse(req.params.eventId);
    if (eventId !== req.auth.eventId) {
      throw new HttpError(403, 'Access to this event is not permitted');
    }

    const event = handleSupabaseMaybe<EventRow>(
      await supabase
        .from('events')
        .select('id, name, slug, base_path, starts_at, ends_at')
        .eq('id', eventId)
        .maybeSingle(),
      'Event not found',
    );

    if (!event) {
      throw new HttpError(404, 'Event not found');
    }

    const categories = ensureRows<CategoryRow>(
      await supabase
        .from('categories')
        .select('id, event_id, code, name, description, display_order')
        .eq('event_id', eventId)
        .order('display_order', { ascending: true }),
      'Failed to load categories',
    );

    const nodes = ensureRows<NodeRow>(
      await supabase
        .from('nodes')
        .select('id, event_id, code, name, sequence, is_relay, counts_to_overall, max_time_centiseconds, note')
        .eq('event_id', eventId)
        .order('sequence', { ascending: true }),
      'Failed to load nodes',
    );

    const competitorCountResponse = await supabase
      .from('competitors')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId);

    if (competitorCountResponse.error) {
      throw new HttpError(500, 'Failed to count competitors', competitorCountResponse.error);
    }

    res.json({
      event,
      categories,
      nodes,
      competitorCount: competitorCountResponse.count ?? 0,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/events/:eventId/competitors', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const eventId = z.string().uuid().parse(req.params.eventId);
    if (eventId !== req.auth.eventId) {
      throw new HttpError(403, 'Access to this event is not permitted');
    }

    const payload = createCompetitorSchema.parse(req.body ?? {});
    await assertCategoryExists(eventId, payload.categoryCode);

    const insertPayload: Record<string, unknown> = {
      event_id: eventId,
      category_code: payload.categoryCode,
      display_name: payload.displayName,
      club: payload.club ?? null,
      start_number: payload.startNumber ?? null,
      birth_year: payload.birthYear ?? null,
      notes: payload.notes ?? null,
    };

    const insert = await supabase.from('competitors').insert(insertPayload).select().maybeSingle();

    if (insert.error) {
      if (insert.error.code === '23505') {
        throw new HttpError(409, 'Competitor with this start number already exists', insert.error);
      }
      throw new HttpError(500, 'Failed to create competitor', insert.error);
    }

    const competitor = insert.data as CompetitorRow | null;
    if (!competitor) {
      throw new HttpError(500, 'Failed to create competitor');
    }

    let token: string | null = null;
    if (payload.generateToken) {
      token = await generateUniqueToken(eventId);

      const update = await supabase
        .from('competitors')
        .update({ qr_token: token, qr_token_issued_at: new Date().toISOString() })
        .eq('id', competitor.id)
        .select('id, qr_token, qr_token_issued_at')
        .maybeSingle();

      if (update.error) {
        throw new HttpError(500, 'Failed to assign QR token', update.error);
      }

      const tokenInsert = await supabase.from('qr_tokens').insert({
        event_id: eventId,
        competitor_id: competitor.id,
        token,
        issued_by: req.auth.userId,
      });

      if (tokenInsert.error) {
        throw new HttpError(500, 'Failed to persist QR token', tokenInsert.error);
      }

      await insertAuditLog({
        eventId,
        competitorId: competitor.id,
        action: 'token_generated',
        newValue: { token },
        userId: req.auth.userId,
        role: req.auth.role,
        ip: req.ip ?? null,
      });
    }

    res.status(201).json({
      competitor: {
        ...competitor,
        qr_token: token ?? competitor.qr_token ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/competitors/:competitorId', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const competitorId = z.string().uuid().parse(req.params.competitorId);

    const competitor = handleSupabaseMaybe<CompetitorRow>(
      await supabase
        .from('competitors')
        .select('id, event_id, category_code, display_name, club, start_number, birth_year, notes, qr_token')
        .eq('id', competitorId)
        .maybeSingle(),
      'Competitor not found',
    );

    if (!competitor || competitor.event_id !== req.auth.eventId) {
      throw new HttpError(404, 'Competitor not found');
    }

    const payload = updateCompetitorSchema.parse(req.body ?? {});

    if (payload.categoryCode) {
      await assertCategoryExists(req.auth.eventId, payload.categoryCode);
    }

    const updatePayload: Record<string, unknown> = {};
    if (payload.displayName !== undefined) updatePayload.display_name = payload.displayName;
    if (payload.categoryCode !== undefined) updatePayload.category_code = payload.categoryCode;
    if (payload.club !== undefined) updatePayload.club = payload.club;
    if (payload.startNumber !== undefined) updatePayload.start_number = payload.startNumber;
    if (payload.birthYear !== undefined) updatePayload.birth_year = payload.birthYear;
    if (payload.notes !== undefined) updatePayload.notes = payload.notes;

    if (Object.keys(updatePayload).length === 0) {
      res.json({ competitor });
      return;
    }

    const update = await supabase
      .from('competitors')
      .update(updatePayload)
      .eq('id', competitorId)
      .select()
      .maybeSingle();

    if (update.error) {
      if (update.error.code === '23505') {
        throw new HttpError(409, 'Competitor with this start number already exists', update.error);
      }
      throw new HttpError(500, 'Failed to update competitor', update.error);
    }

    const updatedCompetitor = update.data;
    if (!updatedCompetitor) {
      throw new HttpError(500, 'Competitor update failed');
    }

    await insertAuditLog({
      eventId: req.auth.eventId,
      competitorId,
      action: 'competitor_updated',
      previousValue: competitor,
      newValue: updatedCompetitor,
      userId: req.auth.userId,
      role: req.auth.role,
      ip: req.ip ?? null,
    });

    res.json({ competitor: updatedCompetitor });
  } catch (error) {
    next(error);
  }
});

router.post('/competitors/:competitorId/token', async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const competitorId = z.string().uuid().parse(req.params.competitorId);
    const { regenerate } = issueTokenSchema.parse(req.body ?? {});

    const competitor = handleSupabaseMaybe<CompetitorRow>(
      await supabase
        .from('competitors')
        .select('id, event_id, qr_token')
        .eq('id', competitorId)
        .maybeSingle(),
      'Competitor not found',
    );

    if (!competitor || competitor.event_id !== req.auth.eventId) {
      throw new HttpError(404, 'Competitor not found');
    }

    const eventId = competitor.event_id;

    if (!regenerate && competitor.qr_token) {
      res.json({ token: competitor.qr_token });
      return;
    }

    if (regenerate && competitor.qr_token) {
      const revoke = await supabase
        .from('qr_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('competitor_id', competitorId)
        .eq('event_id', eventId)
        .is('revoked_at', null);

      if (revoke.error) {
        throw new HttpError(500, 'Failed to revoke previous tokens', revoke.error);
      }

      await insertAuditLog({
        eventId,
        competitorId,
        action: 'token_revoked',
        previousValue: { token: competitor.qr_token },
        userId: req.auth.userId,
        role: req.auth.role,
        ip: req.ip ?? null,
      });
    }

    const token = await generateUniqueToken(eventId);

    const update = await supabase
      .from('competitors')
      .update({
        qr_token: token,
        qr_token_issued_at: new Date().toISOString(),
      })
      .eq('id', competitorId)
      .select('id, qr_token, qr_token_issued_at')
      .maybeSingle();

    if (update.error) {
      throw new HttpError(500, 'Failed to store QR token', update.error);
    }

    const insert = await supabase.from('qr_tokens').insert({
      event_id: eventId,
      competitor_id: competitorId,
      token,
      issued_by: req.auth.userId,
    });

    if (insert.error) {
      throw new HttpError(500, 'Failed to persist QR token', insert.error);
    }

    await insertAuditLog({
      eventId,
      competitorId,
      action: 'token_generated',
      newValue: { token },
      userId: req.auth.userId,
      role: req.auth.role,
      ip: req.ip ?? null,
    });

    res.json({ token });
  } catch (error) {
    next(error);
  }
});

export default router;
