import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SessionRow = {
  id: string;
  user_name: string;
  star_time?: string | null;
  end_time?: string | null;
  total_minutes?: number | null;
  created_at?: string | null;
  last_seen?: string | null;
  multiplier?: number | null;
  event_name?: string | null;
};

export type BroadcastRow = {
  id: string;
  type: string;
  message: string | null;
  image_url: string | null;
  expired_at: string | null;
  created_at: string | null;
};

export type SettingsRow = {
  id: string;
  key: string;
  multiplier: number | null;
  event_name: string | null;
  active: boolean | null;
  updated_at: string | null;
  expires_at: string | null;
};

const env = typeof process !== 'undefined' && process.env ? process.env : {};
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in Expo env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: AsyncStorage,
  },
});
