import { useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MinijuegoScreen from './minijuego';
import ShopScreen from './shop';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {
  ActivityIndicator,
  Alert,
  Platform,
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotificationsAsync(name: string) {
  if (!name || !Device.isDevice) return;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('¡Permiso de notificaciones denegado!');
    return;
  }

  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  try {
    const pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    
    await supabase
      .from('user_wallet')
      .update({ expo_push_token: pushTokenData.data })
      .eq('user_name', name);
  } catch (e) {
    console.log('Error al obtener el push token:', e);
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 500, 250],
      lightColor: '#FF231F7C',
    });
  }
}

type SessionRow = {
  id: string;
  user_name: string;
  start_time?: string | null;
  end_time: string | null;
  total_minutes: number | null;
  last_seen?: string | null;
  created_at?: string | null;
  multiplier?: number | null;
  event_name?: string | null;
};

type NotificationRow = {
  id: string;
  message: string;
  created_at: string;
  read: boolean;
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

function calculateStreak(sessions: { start_time?: string | null }[]): number {
  if (!sessions || sessions.length === 0) return 0;

  const uniqueDates = Array.from(
    new Set(
      sessions.map((s) => {
        const rawDate = s.start_time;
        if (!rawDate) return null;
        return new Date(rawDate).toISOString().split('T')[0];
      }).filter(Boolean)
    )
  ).sort((a, b) => (b! > a! ? 1 : -1)) as string[];

  if (uniqueDates.length === 0) return 0;

  let streak = 0;
  const today = new Date().toISOString().split('T')[0];
  
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  const latestDate = uniqueDates[0];
  if (latestDate !== today && latestDate !== yesterday) {
    return 0;
  }

  let expectedDate = new Date(latestDate);
  
  for (let i = 0; i < uniqueDates.length; i++) {
    const expectedStr = expectedDate.toISOString().split('T')[0];
    if (uniqueDates[i] === expectedStr) {
      streak++;
      expectedDate.setDate(expectedDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Index() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authUserName, setAuthUserName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<'home' | 'minijuego' | 'tienda' | 'eventos'>('home');
  const [ip, setIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  // Estado para la racha de estudio
  const [userStreak, setUserStreak] = useState(0);

  // Estados del menú flotante inferior derecho
  const [showMenu, setShowMenu] = useState(false);

  // Notificaciones (Campanita en Home)
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  const { data: leaders, loading: leadersLoading, error: leadersError, refetch: refetchLeaders } =
    useLeaderboard({ limit: 50 });

  const isAllowed = ip === ALLOWED_IP;
  const systemOpen = isWithinOpenHours(new Date(now));
  const elapsed = activeSession
    ? now - new Date(activeSession.start_time ?? new Date().toISOString()).getTime()
    : 0;

  const fetchNotifications = useCallback(async (name: string) => {
    if (!name) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_name', name)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!error && data) setNotifications(data);
  }, []);

  const fetchUserStreak = useCallback(async (name: string) => {
    if (!name) return;
    const { data, error } = await supabase
      .from('sesiones')
      .select('start_time')
      .eq('user_name', name);

    if (!error && data) {
      const streak = calculateStreak(data);
      setUserStreak(streak);
    }
  }, []);

  // Restaurar sesión guardada localmente al abrir la app y registrar token push
  useEffect(() => {
    const restoreSession = async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        setAuthUserName(saved);
        setIsLoggedIn(true);
        await registerForPushNotificationsAsync(saved);
        await fetchUserStreak(saved);
      }
    };
    restoreSession();
  }, [fetchUserStreak]);

  // Escuchar notificaciones en tiempo real con Supabase Realtime
  useEffect(() => {
    if (!authUserName) return;
    fetchNotifications(authUserName);
    fetchUserStreak(authUserName);

    const channel = supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_name=eq.${authUserName}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as NotificationRow, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUserName, fetchNotifications, fetchUserStreak]);

  // Escuchar broadcasts del administrador en tiempo real
  useEffect(() => {
    const broadcastChannel = supabase
      .channel('public:broadcast')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'broadcast',
        },
        (payload) => {
          const newMessage = payload.new as { message: string };
          
          // Alerta visual inmediata
          Alert.alert('📢 Aviso del Admin', newMessage.message);
          
          // Disparar notificación push local
          Notifications.scheduleNotificationAsync({
            content: {
              title: "Mensaje de la Biblioteca",
              body: newMessage.message,
              sound: true,
            },
            trigger: null,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, []);

  const handleLogin = async () => {
    const name = authUserName.trim();
    const pass = authPassword.trim();
    setAuthError('');

    if (!name || !pass) {
      setAuthError('Ingresa tu usuario y contraseña.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_wallet')
        .select('*')
        .eq('user_name', name)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        if (data.password === pass) {
          await AsyncStorage.setItem(STORAGE_KEY, name);
          setAuthUserName(name);
          setIsLoggedIn(true);
          await registerForPushNotificationsAsync(name);
          await fetchUserStreak(name);
        } else {
          setAuthError('❌ Contraseña incorrecta.');
        }
      } else {
        const { error: insertErr } = await supabase
          .from('user_wallet')
          .insert({ user_name: name, password: pass, coins: 0 });
        if (insertErr) throw insertErr;

        await AsyncStorage.setItem(STORAGE_KEY, name);
        setAuthUserName(name);
        setIsLoggedIn(true);
        await registerForPushNotificationsAsync(name);
        await fetchUserStreak(name);
      }
    } catch (err) {
      console.error(err);
      setAuthError('❌ Error al iniciar sesión.');
    }
  };

  const handleLogout = async () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro de que deseas salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setIsLoggedIn(false);
          setAuthPassword('');
          setShowMenu(false);
        },
      },
    ]);
  };

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
    if (authUserName) checkActiveSession(authUserName);
  }, [authUserName, checkActiveSession]);

  const handleCheckIn = async () => {
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
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('sesiones')
        .insert({ user_name: authUserName, start_time: nowIso, last_seen: nowIso })
        .select()
        .single();

      if (error || !data) throw error ?? new Error('No se pudo crear la sesión');

      setActiveSession(data as SessionRow);
      await fetchUserStreak(authUserName);
      Alert.alert('Check-in registrado', `${authUserName} ya quedó activo.`);
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
      const startTime = new Date(activeSession.start_time ?? endIso).getTime();
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
      await fetchUserStreak(authUserName);
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

  const unreadCount = notifications.filter(n => !n.read).length;

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.loginSafe}>
        <View style={styles.loginCard}>
          <Text style={styles.loginTitle}>Horas <Text style={styles.accent}>biblio</Text></Text>
          <Text style={styles.loginSub}>Inicia sesión con tu cuenta</Text>

          <TextInput
            style={styles.input}
            placeholder="Tu nombre de usuario"
            placeholderTextColor="#64748b"
            value={authUserName}
            onChangeText={setAuthUserName}
            autoCapitalize="words"
          />

          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={authPassword}
            onChangeText={setAuthPassword}
          />

          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

          <Pressable style={styles.primaryButton} onPress={handleLogin}>
            <Text style={styles.primaryButtonText}>Ingresar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <View style={styles.containerContent}>
        {activeTab === 'home' && (
          <ScrollView contentContainerStyle={styles.content}>
            
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>Horas <Text style={styles.accent}>biblio</Text></Text>
                <Text style={styles.subtitle}>Hola, <Text style={{ color: '#f59e0b', fontWeight: '700' }}>{authUserName}</Text></Text>
              </View>

              {/* Campanita de notificaciones en el Home */}
              <Pressable 
                style={styles.bellButton} 
                onPress={() => setShowNotificationsModal(!showNotificationsModal)}
              >
                <Text style={{ fontSize: 20 }}>🔔</Text>
                {unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>

            {/* Desplegable de notificaciones */}
            {showNotificationsModal && (
              <View style={styles.notificationDropdown}>
                <Text style={styles.dropdownTitle}>📢 Últimas Notificaciones</Text>
                {notifications.length === 0 ? (
                  <Text style={styles.emptyNotif}>No tienes notificaciones recientes.</Text>
                ) : (
                  notifications.map((item) => (
                    <View key={item.id} style={styles.notifItem}>
                      <Text style={styles.notifText}>{item.message}</Text>
                      <Text style={styles.notifTime}>
                        {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Estado de la red</Text>
                <Text style={[styles.status, isAllowed ? styles.ok : styles.warn]}>{statusLabel}</Text>
              </View>
              <Text style={styles.meta}>IP: {ip ?? '—'}</Text>
              <Text style={styles.meta}>Horario: {systemOpen ? 'Abierto' : 'Cerrado'} • {String(OPEN_HOUR_AR).padStart(2, '0')}:00–{String(CLOSE_HOUR_AR).padStart(2, '0')}:00</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Control de Asistencia</Text>

              {!activeSession ? (
                <Pressable
                  style={[styles.primaryButton, busy && styles.disabledButton]}
                  onPress={handleCheckIn}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Hacer Check-in</Text>}
                </Pressable>
              ) : (
                <View style={styles.activeBox}>
                  <Text style={styles.activeLabel}>Sesión activa</Text>
                  <Text style={styles.activeText}>{activeSession.user_name}</Text>
                  <Text style={styles.elapsed}>Tiempo: {formatDuration(elapsed)}</Text>
                  <Pressable style={styles.secondaryButton} onPress={handleCheckOut} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>Hacer Check-out</Text>
                  </Pressable>
                </View>
              )}
            </View>
            
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Racha de Estudio</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#f59e0b' }}>
                  🔥 {userStreak} {userStreak === 1 ? 'Día' : 'Días'}
                </Text>
              </View>
              <Text style={styles.meta}>
                {userStreak > 0 
                  ? '¡Excelente constancia! Mantén el ritmo diario.' 
                  : 'Haz un check-in hoy para iniciar tu racha.'}
              </Text>
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
                leaders.map((leader, index) => {
                  const totalMins = leader.minutes || 0;
                  const h = Math.floor(totalMins / 60);
                  const m = totalMins % 60;
                  const timeFormatted = h > 0 ? `${h}h ${m}m` : `${m}m`;

                  return (
                    <View key={`${leader.user_name}-${index}`} style={styles.rankRow}>
                      <Text style={styles.rankPlace}>#{index + 1}</Text>
                      <Text style={styles.rankName}>{leader.user_name}</Text>
                      <Text style={styles.rankMinutes}>{timeFormatted}</Text>
                    </View>
                  );
                })
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

      {/* Botón flotante para cerrar sesión */}
      <View style={styles.floatingContainer}>
        {showMenu && (
          <View style={styles.floatingMenu}>
            <Pressable style={styles.menuItem} onPress={handleLogout}>
              <Text style={styles.menuItemText}>🚪 Cerrar Sesión</Text>
            </Pressable>
          </View>
        )}
        <Pressable 
          style={styles.floatingButton} 
          onPress={() => setShowMenu(!showMenu)}
        >
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </Pressable>
      </View>

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
  loginSafe: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 20 },
  loginCard: { backgroundColor: '#111827', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: '#1f2937' },
  loginTitle: { color: '#f8fafc', fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  loginSub: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  containerContent: { flex: 1 },
  content: { padding: 20, paddingBottom: 80 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  bellButton: { backgroundColor: '#1e293b', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#ef4444', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  notificationDropdown: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: '#334155' },
  dropdownTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  notifItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#334155' },
  notifText: { color: '#cbd5e1', fontSize: 13 },
  notifTime: { color: '#64748b', fontSize: 10, marginTop: 2 },
  emptyNotif: { color: '#64748b', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
  centerScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  sectionTitle: { color: '#f8fafc', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  title: { color: '#f8fafc', fontSize: 32, fontWeight: '700' },
  accent: { color: '#f59e0b' },
  subtitle: { color: '#cbd5e1', marginTop: 4, fontSize: 14 },
  card: { backgroundColor: '#111827', borderRadius: 16, padding: 18, marginBottom: 18, borderWidth: 1, borderColor: '#1f2937' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { color: '#e2e8f0', fontWeight: '600', fontSize: 15 },
  status: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  ok: { backgroundColor: '#14532d', color: '#dcfce7' },
  warn: { backgroundColor: '#7c2d12', color: '#ffedd5' },
  meta: { color: '#cbd5e1', marginTop: 4, fontSize: 13 },
  input: { marginTop: 12, borderWidth: 1, borderColor: '#334155', borderRadius: 10, backgroundColor: '#0f172a', color: '#f8fafc', paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginTop: 8, textAlign: 'center' },
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
  retryButton: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  retryButtonText: { color: '#f8fafc', fontWeight: '600', fontSize: 13 },
  floatingContainer: { position: 'absolute', right: 20, bottom: 75, alignItems: 'flex-end', zIndex: 50 },
  floatingButton: { backgroundColor: '#1e293b', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4 },
  floatingMenu: { backgroundColor: '#1e293b', borderRadius: 10, padding: 6, marginBottom: 8, borderWidth: 1, borderColor: '#334155', width: 140 },
  menuItem: { paddingVertical: 8, paddingHorizontal: 10 },
  menuItemText: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  bottomNav: { flexDirection: 'row', backgroundColor: '#111827', borderTopWidth: 1, borderTopColor: '#1f2937', height: 60 },
  navItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  navItemActive: { borderTopWidth: 2, borderTopColor: '#f59e0b', backgroundColor: '#1f2937' },
  navText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  navTextActive: { color: '#f59e0b' },
});