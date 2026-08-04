/** Single row inside a saved past ranking snapshot (`past_rankings.rows`). */
export type RankingEntry = {
  user_name: string;
  minutes: number;
  online?: boolean;
};

/** Aggregated live leaderboard row derived from `sessions`. */
export type LeaderboardEntry = RankingEntry & {
  online: boolean;
};

/** Row returned by the `get_leaderboard` RPC. */
export type LeaderboardRpcRow = {
  user_name: string;
  minutes: number;
  online: boolean;
};

export type PastRankingRow = {
  id: string;
  title: string;
  rows: RankingEntry[];
  created_at: string;
  updated_at: string;
};

export type FetchLeaderboardOptions = {
  /** Max users returned by the RPC (default: 50, server-capped at 500). */
  limit?: number;
};

export type FetchPastRankingsOptions = {
  limit?: number;
  offset?: number;
};
