import { useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MinijuegoScreen from './minijuego';
import ShopScreen from './shop'; // Asegúrate de tener este archivo creado en la misma carpeta
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { supabase } from '@/integrations/supabase/client';

const ALLOWED_IP = '131.221.0.8';
const STORAGE_KEY = 'horasbiblio_user_name';
const OPEN_HOUR_AR = 7;
const CLOSE_HOUR_AR = 20;

type SessionRow = {
  id: string;
  user_name: string;
  start_time?: string | null;
  star_time?: string | null;
  end_time: string | null;
  total_minutes: number | null;
  last_seen?: string | null;
  created_at?: string | null;
  multiplier?: number | null;
  event_name?: string | null;
};

function getArgHour(d: Date = new Date()) {
  return (d.getUTCHours() + 24 - 3) % 24;
}

function isWithinOpenHours(d: Date = new Date()) {
  const h = getArgHour(d);
  return h >= OPEN_HOUR_AR && h < CLOSE_HOUR_AR;
}

async function fetchPublicIp(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data?.ip ?? null;
  } catch {
    return null;
  }
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Index() {
  // Cambiamos 'Tienda' por 'tienda' en minúsculas para mantener consistencia
  const [activeTab, setActiveTab] = useState<'home' | 'minijuego' | 'tienda' | 'eventos'>('home');

  const [ip, setIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const { data: leaders, loading: leadersLoading, error: leadersError, refetch: refetchLeaders } =
    useLeaderboard({ limit: 50 });

  const isAllowed = ip === ALLOWED_IP;
  const systemOpen = isWithinOpenHours(new Date(now));
  const elapsed = activeSession
    ? now - new Date(activeSession.start_time ?? activeSession.star_time ?? new Date().toISOString()).getTime()
    : 0;

  const checkActiveSession = useCallback(async (name: string) => {
    if (!name) {
      setActiveSession(null);
      return;
    }

    const { data, error } = await supabase
      .from('sesiones')
      .select('*')
      .eq('user_name', name)
      .is('end_time', null)
      .order('start_time', { ascending: false });

    if (error || !data || data.length === 0) {
      setActiveSession(null);
      return;
    }

    setActiveSession(data[0] as SessionRow);
  }, []);

  useEffect(() => {
    const restoreName = async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) setUserName(saved);
    };
    restoreName();
  }, []);

  useEffect(() => {
    fetchPublicIp().then((value) => {
      setIp(value);
      setIpLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSession]);

  useEffect(() => {
    if (userName) checkActiveSession(userName);
  }, [userName, checkActiveSession]);

  const handleCheckIn = async () => {
    const name = userName.trim();
    if (!name) {
      Alert.alert('Falta el nombre', 'Ingresa tu nombre para continuar.');
      return;
    }

    if (!isAllowed) {
      Alert.alert('Red no autorizada', 'Debes estar conectado a la Wi‑Fi de la biblioteca.');
      return;
    }

    if (!systemOpen) {
      Alert.alert('Sistema cerrado', `El horario de conexión es de ${String(OPEN_HOUR_AR).padStart(2, '0')}:00 a ${String(CLOSE_HOUR_AR).padStart(2, '0')}:00 hs.`);
      return;
    }

    try {
      setBusy(true);
      await AsyncStorage.setItem(STORAGE_KEY, name);

      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('sesiones')
        .insert({ user_name: name, start_time: nowIso, last_seen: nowIso })
        .select()
        .single();

      if (error || !data) {
        throw error ?? new Error('No se pudo crear la sesión');
      }

      setActiveSession(data as SessionRow);
      Alert.alert('Check-in registrado', `${name} ya quedó activo.`);
    } catch (error) {
      console.error(error);
      Alert.alert('Error al hacer check-in', 'Reintentá en unos segundos.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!activeSession) return;

    try {
      setBusy(true);
      const currentIp = await fetchPublicIp();
      setIp(currentIp);

      const endIso = new Date().toISOString();
      const startTime = new Date(activeSession.start_time ?? activeSession.star_time ?? endIso).getTime();
      const { error } = await supabase
        .from('sesiones')
        .update({
          end_time: endIso,
          total_minutes: Math.max(1, Math.round((new Date(endIso).getTime() - startTime) / 60000)),
          last_seen: endIso,
        })
        .eq('id', activeSession.id);

      if (error) throw error;

      setActiveSession(null);
      await refetchLeaders();
      Alert.alert('Check-out', 'Tu sesión quedó cerrada.');
    } catch (error) {
      console.error(error);
      Alert.alert('Error al cerrar sesión', 'No se pudo registrar el check-out.');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = useMemo(() => {
    if (ipLoading) return 'Comprobando red…';
    if (!ip) return 'Sin red detectada';
    return isAllowed ? 'Wi‑Fi autorizada' : 'Wi‑Fi no autorizada';
  }, [ip, ipLoading, isAllowed]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* CONTENIDO CONDICIONAL SEGÚN LA PESTAÑA ACTIVA */}
      <View style={styles.containerContent}>
        {activeTab === 'home' && (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Horas <Text style={styles.accent}>biblio</Text></Text>
              <Text style={styles.subtitle}>Registro de tiempo de conexión Wi‑Fi</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Estado de la red</Text>
                <Text style={[styles.status, isAllowed ? styles.ok : styles.warn]}>{statusLabel}</Text>
              </View>
              <Text style={styles.meta}>IP: {ip ?? '—'}</Text>
              <Text style={styles.meta}>Horario: {systemOpen ? 'Abierto' : 'Cerrado'} • {String(OPEN_HOUR_AR).padStart(2, '0')}:00–{String(CLOSE_HOUR_AR).padStart(2, '0')}:00</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Tu nombre</Text>
              <TextInput
                value={userName}
                onChangeText={setUserName}
                placeholder="Ingresá tu nombre"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                autoCapitalize="words"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.primaryButton, (!userName.trim() || busy) && styles.disabledButton]}
                onPress={handleCheckIn}
                disabled={!userName.trim() || busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Check-in</Text>}
              </Pressable>

              {activeSession ? (
                <View style={styles.activeBox}>
                  <Text style={styles.activeLabel}>Sesión activa</Text>
                  <Text style={styles.activeText}>{activeSession.user_name}</Text>
                  <Text style={styles.elapsed}>Tiempo: {formatDuration(elapsed)}</Text>
                  <Pressable style={styles.secondaryButton} onPress={handleCheckOut} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>Check-out</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Ranking</Text>
              {leadersLoading ? (
                <ActivityIndicator color="#f59e0b" style={styles.rankLoader} />
              ) : leadersError ? (
                <View>
                  <Text style={styles.rankError}>{leadersError}</Text>
                  <Pressable style={styles.retryButton} onPress={() => void refetchLeaders()}>
                    <Text style={styles.retryButtonText}>Reintentar</Text>
                  </Pressable>
                </View>
              ) : leaders.length === 0 ? (
                <Text style={styles.meta}>Todavía no hay registros.</Text>
              ) : (
                leaders.map((leader, index) => (
                  <View key={`${leader.user_name}-${index}`} style={styles.rankRow}>
                    <Text style={styles.rankPlace}>#{index + 1}</Text>
                    <Text style={styles.rankName}>{leader.user_name}</Text>
                    <Text style={styles.rankMinutes}>{leader.minutes} min</Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )}

        {activeTab === 'minijuego' && <MinijuegoScreen />}

        {activeTab === 'tienda' && <ShopScreen />}

        {activeTab === 'eventos' && (
          <View style={styles.centerScreen}>
            <Text style={styles.sectionTitle}>📅 Eventos</Text>
            <Text style={styles.meta}>Sección de próximos eventos y charlas.</Text>
          </View>
        )}
      </View>

      {/* BARRA DE NAVEGACIÓN INFERIOR FIJA */}
      <View style={styles.bottomNav}>
        <Pressable 
          style={[styles.navItem, activeTab === 'home' && styles.navItemActive]} 
          onPress={() => setActiveTab('home')}
        >
          <Text style={[styles.navText, activeTab === 'home' && styles.navTextActive]}>🏠 Inicio</Text>
        </Pressable>

        <Pressable 
          style={[styles.navItem, activeTab === 'minijuego' && styles.navItemActive]} 
          onPress={() => setActiveTab('minijuego')}
        >
          <Text style={[styles.navText, activeTab === 'minijuego' && styles.navTextActive]}>🎮 Minijuego</Text>
        </Pressable>

        <Pressable 
          style={[styles.navItem, activeTab === 'tienda' && styles.navItemActive]} 
          onPress={() => setActiveTab('tienda')}
        >
          <Text style={[styles.navText, activeTab === 'tienda' && styles.navTextActive]}>🛒 Tienda</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  containerContent: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  centerScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  sectionTitle: { color: '#f8fafc', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  header: { marginBottom: 20 },
  title: { color: '#f8fafc', fontSize: 36, fontWeight: '700' },
  accent: { color: '#f59e0b' },
  subtitle: { color: '#cbd5e1', marginTop: 8, fontSize: 16 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { color: '#e2e8f0', fontWeight: '600', fontSize: 15 },
  status: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  ok: { backgroundColor: '#14532d', color: '#dcfce7' },
  warn: { backgroundColor: '#7c2d12', color: '#ffedd5' },
  meta: { color: '#cbd5e1', marginTop: 4, fontSize: 13 },
  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryButton: { marginTop: 14, backgroundColor: '#f59e0b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  secondaryButton: { marginTop: 10, backgroundColor: '#1d4ed8', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  disabledButton: { opacity: 0.6 },
  activeBox: { marginTop: 14, borderRadius: 12, backgroundColor: '#052e16', padding: 12 },
  activeLabel: { color: '#bbf7d0', fontSize: 12, textTransform: 'uppercase', fontWeight: '700' },
  activeText: { color: '#f8fafc', fontSize: 22, fontWeight: '700', marginTop: 6 },
  elapsed: { color: '#d1fae5', marginTop: 6, fontSize: 14 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  rankPlace: { color: '#fbbf24', fontWeight: '700', width: 36 },
  rankName: { flex: 1, color: '#f8fafc', fontWeight: '600' },
  rankMinutes: { color: '#cbd5e1', fontWeight: '600' },
  rankLoader: { marginTop: 12 },
  rankError: { color: '#fca5a5', marginTop: 8, fontSize: 13 },
  retryButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: { color: '#f8fafc', fontWeight: '600', fontSize: 13 },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    height: 60,
  },
  navItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#f59e0b',
    backgroundColor: '#1f2937',
  },
  navText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  navTextActive: {
    color: '#f59e0b',
  },
});