export type UserRole = 'admin' | 'judge' | 'calculator';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  active: boolean;
}

export interface EventRow {
  id: string;
  name: string;
  slug: string;
  base_path: string;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface CategoryRow {
  id: string;
  event_id: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
}

export interface NodeRow {
  id: string;
  event_id: string;
  code: string;
  name: string;
  sequence: number;
  is_relay: boolean;
  counts_to_overall: boolean;
  max_time_centiseconds?: number | null;
  note?: string | null;
}

export interface UserEventRoleRow {
  id: string;
  user_id: string;
  event_id: string;
  role: UserRole;
  node_id: string | null;
  allowed_category_codes: string[];
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  event_id: string;
  role: UserRole;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  device_info?: string | null;
  created_ip?: string | null;
}

export interface CompetitorRow {
  id: string;
  event_id: string;
  category_code: string;
  display_name: string;
  club: string | null;
  start_number: number | null;
  birth_year?: number | null;
  notes?: string | null;
  qr_token: string | null;
  qr_token_issued_at?: string | null;
}

export interface AttemptRow {
  id: string;
  event_id: string;
  competitor_id: string;
  node_id: string;
  attempt_number: number;
  result_kind: 'time' | 'fault';
  centiseconds: number | null;
  fault_code: string | null;
  note?: string | null;
  locked: boolean;
  recorded_by: string | null;
  recorded_role: UserRole | null;
  created_at?: string;
  updated_at?: string;
}

export interface AttemptAuditRow {
  id: string;
  event_id: string;
  attempt_id: string | null;
  competitor_id: string | null;
  node_id: string | null;
  attempt_number: number | null;
  action: string;
  previous_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_role: UserRole | null;
  created_at: string;
}

export interface AuthContext {
  userId: string;
  eventId: string;
  role: UserRole;
  sessionId: string;
  nodeIds?: string[];
  allowedCategories?: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}
