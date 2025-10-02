export type UserRole = 'admin' | 'judge' | 'calculator';

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  basePath: string;
}

export interface CategoryDto {
  id: string;
  event_id: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
}

export interface NodeDto {
  id: string;
  event_id: string;
  code: string;
  name: string;
  sequence: number;
  is_relay: boolean;
  counts_to_overall: boolean;
}

export interface AssignmentsDto {
  nodeIds: string[];
  allowedCategories: string[];
}

export interface AuthLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  user: UserSummary;
  event: EventSummary;
  assignments: AssignmentsDto;
  categories: CategoryDto[];
  nodes: NodeDto[];
}

export interface RefreshResponse extends AuthLoginResponse {}

export interface CompetitorSummary {
  id: string;
  displayName: string;
  categoryCode: string;
  club: string | null;
  startNumber: number | null;
}

export interface AttemptDto {
  id: string;
  event_id: string;
  competitor_id: string;
  node_id: string;
  attempt_number: number;
  result_kind: 'time' | 'fault';
  centiseconds: number | null;
  fault_code: string | null;
  note: string | null;
  locked: boolean;
  recorded_by: string | null;
  recorded_role: UserRole | null;
  created_at?: string;
  updated_at?: string;
}

export interface JudgeLookupResponse {
  competitor: CompetitorSummary;
  attempts: AttemptDto[];
  nodeIds: string[];
}

export interface JudgeAttemptRequest {
  competitorId: string;
  nodeId: string;
  attemptNumber: number;
  result:
    | {
        kind: 'time';
        centiseconds: number;
      }
    | {
        kind: 'fault';
        faultCode: string;
      };
  note?: string;
}

export interface JudgeAttemptResponse {
  attempt: AttemptDto;
}

export interface CalculatorCompetitorResponse {
  competitor: {
    id: string;
    displayName: string;
    categoryCode: string;
    club: string | null;
    startNumber: number | null;
    qrToken: string | null;
  };
  nodes: NodeDto[];
  attemptsByNode: Record<string, AttemptDto[]>;
  bestByNode: Record<string, unknown>;
}

export interface CalculatorUpdateAttemptRequest {
  result:
    | {
        kind: 'time';
        centiseconds: number;
      }
    | {
        kind: 'fault';
        faultCode: string;
      };
  note?: string;
}

export interface CalculatorUpdateAttemptResponse {
  attempt: AttemptDto;
}

export interface LeaderboardEntry {
  event_id: string;
  category_code: string;
  competitor_id: string;
  placement_sum: number;
  tie_break_centiseconds_sum: number | null;
  counted_nodes: number;
  has_non_time: boolean;
  competitor_count: number;
  overall_rank: number;
  competitor: {
    id: string;
    displayName: string;
    club: string | null;
    startNumber: number | null;
  } | null;
  nodes: unknown[];
}

export interface RelayLeaderboardEntry {
  event_id: string;
  category_code: string;
  competitor_id: string;
  placement_sum: number;
  tie_break_centiseconds_sum: number | null;
  counted_nodes: number;
  competitor_count: number;
  relay_rank: number;
  competitor: {
    id: string;
    displayName: string;
    club: string | null;
    startNumber: number | null;
  } | null;
}

export interface LeaderboardResponse {
  event: EventSummary;
  categoryLeaderboards: LeaderboardEntry[];
  relayLeaderboards: RelayLeaderboardEntry[];
}

export interface AdminEventContextResponse {
  event: EventSummary & {
    starts_at: string | null;
    ends_at: string | null;
  };
  categories: CategoryDto[];
  nodes: (NodeDto & { max_time_centiseconds: number | null; note: string | null })[];
  competitorCount: number;
}

export interface AdminCreateCompetitorRequest {
  displayName: string;
  categoryCode: string;
  club?: string;
  startNumber?: number;
  birthYear?: number;
  notes?: string;
  generateToken?: boolean;
}

export interface AdminUpdateCompetitorRequest {
  displayName?: string;
  categoryCode?: string;
  club?: string | null;
  startNumber?: number | null;
  birthYear?: number | null;
  notes?: string | null;
}
