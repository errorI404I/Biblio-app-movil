import { supabase } from '@/integrations/supabase/client';
import type {
  FetchLeaderboardOptions,
  FetchPastRankingsOptions,
  LeaderboardEntry,
  LeaderboardRpcRow,
  PastRankingRow,
  RankingEntry,
} from '@/types/rankings';

const DEFAULT_LEADERBOARD_LIMIT = 50;
const DEFAULT_PAST_RANKINGS_LIMIT = 20;

export class RankingsFetchError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RankingsFetchError';
    this.cause = cause;
  }
}

function isRankingEntry(value: unknown): value is RankingEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.user_name === 'string' && typeof row.minutes === 'number';
}

function parseRankingRows(rows: unknown): RankingEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isRankingEntry);
}

function mapRpcRow(row: LeaderboardRpcRow): LeaderboardEntry {
  return {
    user_name: row.user_name,
    minutes: Number(row.minutes),
    online: Boolean(row.online),
  };
}

function toRankingsError(error: unknown, fallback: string): RankingsFetchError {
  if (error instanceof RankingsFetchError) return error;

  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    if (message.includes('JWT') || message.includes('permission') || message.includes('RLS')) {
      return new RankingsFetchError('No tenés permisos para ver el ranking.', error);
    }
    return new RankingsFetchError(message || fallback, error);
  }

  return new RankingsFetchError(fallback, error);
}

/** Fetches the live leaderboard via the `get_leaderboard` RPC. */
export async function fetchLiveLeaderboard(
  options: FetchLeaderboardOptions = {},
): Promise<LeaderboardEntry[]> {
  const limit = options.limit ?? DEFAULT_LEADERBOARD_LIMIT;

  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit });

  if (error) {
    throw toRankingsError(error, 'No se pudo cargar el ranking.');
  }

  return ((data ?? []) as LeaderboardRpcRow[]).map(mapRpcRow);
}

/** Fetches archived ranking snapshots from `past_rankings`. */
export async function fetchPastRankings(
  options: FetchPastRankingsOptions = {},
): Promise<PastRankingRow[]> {
  const limit = options.limit ?? DEFAULT_PAST_RANKINGS_LIMIT;
  const offset = options.offset ?? 0;

  const { data, error } = await supabase
    .from('past_rankings')
    .select('id,title,rows,created_at,updated_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw toRankingsError(error, 'No se pudieron cargar los rankings anteriores.');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    rows: parseRankingRows(row.rows),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function getRankingsErrorMessage(error: unknown): string {
  if (error instanceof RankingsFetchError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Ocurrió un error inesperado al cargar el ranking.';
}
