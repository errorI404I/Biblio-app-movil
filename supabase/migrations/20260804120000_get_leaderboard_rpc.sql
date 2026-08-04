CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE (
  user_name text,
  minutes bigint,
  online boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    s.user_name,
    COALESCE(SUM(s.total_minutes), 0)::bigint AS minutes,
    BOOL_OR(s.end_time IS NULL) AS online
  FROM public.sessions AS s
  GROUP BY s.user_name
  ORDER BY minutes DESC, s.user_name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO authenticated;
