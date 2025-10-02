import { supabase } from '../supabase.js';
import type { UserRole } from '../types.js';
import { HttpError } from './errors.js';

interface AuditPayload {
  eventId: string;
  attemptId?: string | null;
  competitorId?: string | null;
  nodeId?: string | null;
  attemptNumber?: number | null;
  action: 'attempt_created' | 'attempt_updated' | 'attempt_deleted' | 'token_generated' | 'token_revoked' | 'competitor_updated';
  previousValue?: unknown;
  newValue?: unknown;
  userId?: string | null;
  role?: UserRole | null;
  ip?: string | null;
}

export async function insertAuditLog(payload: AuditPayload) {
  const insert = await supabase.from('attempt_audit_logs').insert({
    event_id: payload.eventId,
    attempt_id: payload.attemptId ?? null,
    competitor_id: payload.competitorId ?? null,
    node_id: payload.nodeId ?? null,
    attempt_number: payload.attemptNumber ?? null,
    action: payload.action,
    previous_value: payload.previousValue ?? null,
    new_value: payload.newValue ?? null,
    changed_by: payload.userId ?? null,
    changed_role: payload.role ?? null,
    changed_ip: payload.ip ?? null,
  });

  if (insert.error) {
    throw new HttpError(500, 'Failed to insert audit log', insert.error);
  }
}
