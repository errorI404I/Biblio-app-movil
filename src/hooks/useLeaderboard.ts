import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchLiveLeaderboard,
  getRankingsErrorMessage,
  RankingsFetchError,
} from '@/services/rankings';
import type { FetchLeaderboardOptions, LeaderboardEntry } from '@/types/rankings';

type UseLeaderboardOptions = FetchLeaderboardOptions & {
  /** Subscribe to realtime changes on `sessions` (default: true). */
  realtime?: boolean;
};

type UseLeaderboardResult = {
  data: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export function useLeaderboard(options: UseLeaderboardOptions = {}): UseLeaderboardResult {
  const { limit, realtime = true } = options;

  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const leaders = await fetchLiveLeaderboard({ limit });
      if (isMountedRef.current) setData(leaders);
    } catch (cause) {
      if (!isMountedRef.current) return;
      const message = getRankingsErrorMessage(cause);
      setError(message);
      if (!(cause instanceof RankingsFetchError)) {
        console.error('[useLeaderboard]', cause);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!realtime) return;

    const channel = supabase
      .channel('sessions-leaderboard-mob')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
        void refetch();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtime, refetch]);

  return { data, loading, error, refetch };
}
