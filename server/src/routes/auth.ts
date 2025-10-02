import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';
import { verifyPassword } from '../utils/passwords.js';
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
} from '../tokens.js';
import { env } from '../env.js';
import { HttpError } from '../utils/errors.js';
import { ensureRows, handleSupabaseMaybe } from '../utils/supabase.js';
import type {
  CategoryRow,
  EventRow,
  NodeRow,
  UserEventRoleRow,
  UserRow,
  UserSessionRow,
} from '../types.js';
import { authenticate } from '../middleware/authenticate.js';

const DEFAULT_EVENT_SLUG = 'draci-smycka';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  eventSlug: z.string().min(1).optional(),
  deviceName: z.string().min(1).max(200).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const logoutSchema = z.object({
  allDevices: z.boolean().optional(),
});

function collectAssignments(assignments: UserEventRoleRow[], role: UserRow['role']) {
  const byRole = assignments.filter((entry) => entry.role === role);
  const nodeIds = Array.from(
    new Set(byRole.map((entry) => entry.node_id).filter((id): id is string => Boolean(id))),
  );
  const allowedCategories = Array.from(
    new Set(
      byRole
        .flatMap((entry) => entry.allowed_category_codes ?? [])
        .filter((code): code is string => Boolean(code)),
    ),
  );
  return { nodeIds, allowedCategories };
}

async function loadEventContext(eventId: string) {
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
      .select('id, event_id, code, name, sequence, is_relay, counts_to_overall')
      .eq('event_id', eventId)
      .order('sequence', { ascending: true }),
    'Failed to load nodes',
  );

  return { categories, nodes };
}

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password, eventSlug, deviceName } = loginSchema.parse(req.body ?? {});
    const normalizedEmail = email.trim().toLowerCase();

    const user = handleSupabaseMaybe<UserRow>(
      await supabase
        .from('users')
        .select('id, email, password_hash, display_name, role, active')
        .ilike('email', normalizedEmail)
        .maybeSingle(),
      'Invalid credentials',
    );

    if (!user) {
      throw new HttpError(401, 'Invalid credentials');
    }

    if (!user.active) {
      throw new HttpError(403, 'User disabled');
    }

    let passwordOk = false;
    try {
      passwordOk = await verifyPassword(user.password_hash, password);
    } catch (error) {
      return next(new HttpError(500, 'Failed to verify credentials', error));
    }

    if (!passwordOk) {
      throw new HttpError(401, 'Invalid credentials');
    }

    const targetSlug = eventSlug ?? DEFAULT_EVENT_SLUG;

    const event = handleSupabaseMaybe<EventRow>(
      await supabase
        .from('events')
        .select('id, name, slug, base_path')
        .eq('slug', targetSlug)
        .maybeSingle(),
      'Event not found',
    );

    if (!event) {
      throw new HttpError(404, 'Event not found');
    }

    const assignments = ensureRows<UserEventRoleRow>(
      await supabase
        .from('user_event_roles')
        .select('id, user_id, event_id, role, node_id, allowed_category_codes')
        .eq('user_id', user.id)
        .eq('event_id', event.id),
      'Failed to load user assignments',
    );

    if (user.role !== 'admin' && assignments.every((entry) => entry.role !== user.role)) {
      throw new HttpError(403, 'No assignment for this event');
    }

    const { categories, nodes } = await loadEventContext(event.id);
    const { nodeIds, allowedCategories } = collectAssignments(assignments, user.role);

    const defaultCategories = categories.map((category) => category.code);
    const effectiveCategories = allowedCategories.length > 0 ? allowedCategories : defaultCategories;

    if (user.role === 'judge' && nodeIds.length === 0) {
      throw new HttpError(403, 'Judge has no assigned nodes');
    }

    const sessionId = randomUUID();
    const tokenPayload = {
      sub: user.id,
      eventId: event.id,
      role: user.role,
      sessionId,
      nodeIds,
      allowedCategories: effectiveCategories,
    } as const;

    const [accessToken, refreshToken] = [
      createAccessToken(tokenPayload),
      createRefreshToken(tokenPayload),
    ];

    const refreshHash = hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

    const sessionInsert = await supabase.from('user_sessions').insert({
      id: sessionId,
      user_id: user.id,
      event_id: event.id,
      role: user.role,
      refresh_token_hash: refreshHash,
      expires_at: refreshExpiresAt,
      device_info: deviceName ?? null,
      created_ip: req.ip ?? null,
    });

    if (sessionInsert.error) {
      throw new HttpError(500, 'Failed to create session', sessionInsert.error);
    }

    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    res.json({
      accessToken,
      refreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        basePath: event.base_path,
      },
      assignments: {
        nodeIds,
        allowedCategories: effectiveCategories,
      },
      categories,
      nodes,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body ?? {});

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (error) {
      throw new HttpError(401, 'Invalid refresh token', error);
    }

    if (payload.type !== 'refresh') {
      throw new HttpError(401, 'Invalid refresh token');
    }

    const session = handleSupabaseMaybe<UserSessionRow>(
      await supabase
        .from('user_sessions')
        .select('id, user_id, event_id, role, refresh_token_hash, expires_at, revoked_at')
        .eq('id', payload.sessionId)
        .eq('user_id', payload.sub)
        .maybeSingle(),
      'Session not found',
    );

    if (!session) {
      throw new HttpError(401, 'Session not found');
    }

    if (session.revoked_at) {
      throw new HttpError(401, 'Session revoked');
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new HttpError(401, 'Session expired');
    }

    const expectedHash = hashRefreshToken(refreshToken);
    if (expectedHash !== session.refresh_token_hash) {
      throw new HttpError(401, 'Refresh token mismatch');
    }

    const user = handleSupabaseMaybe<UserRow>(
      await supabase
        .from('users')
        .select('id, email, display_name, role, active')
        .eq('id', payload.sub)
        .maybeSingle(),
      'User not found',
    );

    if (!user) {
      throw new HttpError(401, 'User not found');
    }

    if (!user.active) {
      throw new HttpError(403, 'User disabled');
    }

    const event = handleSupabaseMaybe<EventRow>(
      await supabase
        .from('events')
        .select('id, name, slug, base_path')
        .eq('id', session.event_id)
        .maybeSingle(),
      'Event not found',
    );

    if (!event) {
      throw new HttpError(404, 'Event not found');
    }

    const assignments = ensureRows<UserEventRoleRow>(
      await supabase
        .from('user_event_roles')
        .select('id, user_id, event_id, role, node_id, allowed_category_codes')
        .eq('user_id', user.id)
        .eq('event_id', event.id),
      'Failed to load user assignments',
    );

    const { categories, nodes } = await loadEventContext(event.id);
    const { nodeIds, allowedCategories } = collectAssignments(assignments, user.role);
    const defaultCategories = categories.map((category) => category.code);
    const effectiveCategories = allowedCategories.length > 0 ? allowedCategories : defaultCategories;

    const tokenPayload = {
      sub: user.id,
      eventId: event.id,
      role: user.role,
      sessionId: session.id,
      nodeIds,
      allowedCategories: effectiveCategories,
    } as const;

    const newAccessToken = createAccessToken(tokenPayload);
    const newRefreshToken = createRefreshToken(tokenPayload);
    const newRefreshHash = hashRefreshToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

    const update = await supabase
      .from('user_sessions')
      .update({
        refresh_token_hash: newRefreshHash,
        expires_at: newExpiresAt,
      })
      .eq('id', session.id);

    if (update.error) {
      throw new HttpError(500, 'Failed to update session', update.error);
    }

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        basePath: event.base_path,
      },
      assignments: {
        nodeIds,
        allowedCategories: effectiveCategories,
      },
      categories,
      nodes,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    const { allDevices } = logoutSchema.parse(req.body ?? {});

    if (allDevices) {
      const update = await supabase
        .from('user_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', req.auth.userId)
        .eq('event_id', req.auth.eventId)
        .is('revoked_at', null);

      if (update.error) {
        throw new HttpError(500, 'Failed to revoke sessions', update.error);
      }
    } else {
      const update = await supabase
        .from('user_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', req.auth.sessionId);

      if (update.error) {
        throw new HttpError(500, 'Failed to revoke session', update.error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
