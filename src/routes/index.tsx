import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MinijuegoScreen from './minijuego';
import ShopScreen from './shop';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Audio } from 'expo-av';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from 'react-native';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { supabase } from '@/integrations/supabase/client';

const ALLOWED_IP = '131.221.0.8';
const STORAGE_KEY = 'horasbiblio_user_name';
const OPEN_HOUR_AR = 7;
const CLOSE_HOUR_AR = 20;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotificationsAsync(name: string) {
  if (!name || !Device.isDevice) return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return;
    const pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('user_wallet').update({ expo_push_token: pushTokenData.data }).eq('user_name', name);
  } catch (e) {
    console.log('Error push token:', e);
  }
}

async function checkAndRegisterPushToken(name: string) {
  if (!name) return;
  try {
    const { data } = await supabase.from('user_wallet').select('expo_push_token').eq('user_name', name).single();
    if (data && !data.expo_push_token) {
      await registerForPushNotificationsAsync(name);
    }
  } catch (e) {
    console.log('Error check token:', e);
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
  if (latestDate !== today && latestDate !== yesterday) return 0;

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

// --- Buscador y Conversor de Audio ---
async function getDirectAudioUrlFromName(songName: string): Promise<string | null> {
  try {
    const searchRes = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(songName)}&filter=videos`);
    const searchData = await searchRes.json();
    if (!searchData?.items?.length) return null;

    const videoId = searchData.items[0].url.split('/watch?v=')[1];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: youtubeUrl, downloadMode: 'audio', audioFormat: 'mp3' }),
    });

    const cobaltData = await cobaltRes.json();
    return cobaltData.url || cobaltData.picker?.[0]?.url || null;
  } catch (error) {
    console.error("Error al obtener audio:", error);
    return null;
  }
}

export function MobileMusicPlayer({ userName }: { userName: string }) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentSongData, setCurrentSongData] = useState({ name: 'Esperando canción...', url: '' });
  const [modalVisible, setModalVisible] = useState(false);
  const [songInput, setSongInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  
  const [allSongs, setAllSongs] = useState<string[]>([
    'Queen - Bohemian Rhapsody',
    'Hans Zimmer - Interstellar Main Theme',
    'Charly Garcia - Inconsciente Colectivo',
    'Lofi Hip Hop Beats - Study Music',
    'Daft Punk - Get Lucky',
    'Soda Stereo - De Musica Ligera'
  ]);
  
  const sound = useRef<Audio.Sound | null>(null);

  const loadSongSuggestions = async () => {
    try {
      const { data } = await supabase.from('song_queue').select('song_name').limit(50);
      if (data && data.length > 0) {
        const dbSongs = data.map(item => item.song_name);
        setAllSongs(prev => Array.from(new Set([...dbSongs, ...prev])));
      }
    } catch (e) {
      console.log("Error cargando sugerencias:", e);
    }
  };

  useEffect(() => {
    async function setup() {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true, shouldDuckAndroid: true });
      loadSongSuggestions();
    }
    setup();
    return () => { if (sound.current) sound.current.unloadAsync(); };
  }, []);

  useEffect(() => {
    const fetchCurrentState = async () => {
      const { data } = await supabase.from('player_state').select('*').eq('id', 1);
      if (data && data.length > 0) {
        setCurrentSongData({ name: data[0].song_title || 'Música en vivo', url: data[0].current_song || '' });
      }
    };
    fetchCurrentState();

    const channel = supabase.channel('public:player_state')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_state', filter: 'id=eq.1' }, 
        async (payload: any) => {
          const newName = payload.new.song_title || 'Música en vivo';
          const newUrl = payload.new.current_song;
          setCurrentSongData({ name: newName, url: newUrl });
          if (isConnected && newUrl) {
            if (sound.current) await sound.current.unloadAsync();
            const { sound: newSound } = await Audio.Sound.createAsync({ uri: newUrl }, { shouldPlay: true });
            sound.current = newSound;
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isConnected]);

  const toggleConnection = async () => {
    try {
      if (isConnected) {
        if (sound.current) await sound.current.stopAsync();
        setIsConnected(false);
      } else {
        if (!currentSongData.url) return Alert.alert("Aviso", "No hay ninguna canción reproduciéndose.");
        if (sound.current) await sound.current.unloadAsync();
        const { sound: newSound } = await Audio.Sound.createAsync({ uri: currentSongData.url }, { shouldPlay: true });
        sound.current = newSound;
        setIsConnected(true);
      }
    } catch (e) {
      Alert.alert("Error", "No se pudo reproducir el audio.");
    }
  };

  const handleTextChange = (text: string) => {
    setSongInput(text);
    if (text.trim().length > 0) {
      setSuggestions(allSongs.filter(song => song.toLowerCase().includes(text.toLowerCase())));
    } else {
      setSuggestions([]);
    }
  };
const handleAddSongToQueue = async () => {
    if (!songInput.trim()) return Alert.alert('Atención', 'Escribe el nombre de la canción.');
    setLoading(true);
    try {
      // 1. Verificar monedas del usuario actual
      const { data: walletData, error: walletError } = await supabase
        .from('user_wallet')
        .select('coins')
        .eq('user_name', userName);

      if (walletError || !walletData || walletData.length === 0) {
        Alert.alert('Error', 'No se encontró la billetera del usuario.');
        setLoading(false);
        return;
      }

      if (walletData[0].coins < 1) {
        Alert.alert('Monedas insuficientes', 'Necesitas al menos 1 🪙 para pedir una canción.');
        setLoading(false);
        return;
      }

      console.log("Buscando audio para:", songInput);
      const directMp3Url = await getDirectAudioUrlFromName(songInput.trim());
      
      if (!directMp3Url) {
        Alert.alert('Error', 'La API externa no pudo convertir esta canción a MP3 directo. Prueba con otro nombre.');
        setLoading(false);
        return;
      }

      console.log("Audio obtenido con éxito:", directMp3Url);

      // 2. Descontar la moneda
      const { error: updateError } = await supabase
        .from('user_wallet')
        .update({ coins: walletData[0].coins - 1 })
        .eq('user_name', userName);

      if (updateError) {
        console.error("Error al descontar moneda:", updateError);
        throw updateError;
      }

      // 3. Insertar en la cola (song_queue)
      const { error: queueError } = await supabase
        .from('song_queue')
        .insert({ 
          song_name: songInput.trim(), 
          user_name: userName, 
          played: false 
        });

      if (queueError) {
        console.error("Error al insertar en song_queue:", queueError);
        Alert.alert('Error en Base de Datos', queueError.message);
        setLoading(false);
        return;
      }

      // 4. Actualizar el estado global del reproductor
      const { error: playerError } = await supabase
        .from('player_state')
        .update({ 
          current_song: directMp3Url, 
          song_title: songInput.trim() 
        })
        .eq('id', 1);

      if (playerError) {
        console.error("Error al actualizar player_state:", playerError);
      }

      Alert.alert('¡Canción en cola y sonando! 🎶', `"${songInput}" fue procesada con éxito.`);
      setSongInput('');
      setSuggestions([]);
      setModalVisible(false);
      loadSongSuggestions();
    } catch (err: any) {
      console.error("Excepción en handleAddSongToQueue:", err);
      Alert.alert('Error', err?.message || 'No se pudo procesar la solicitud.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSkipSong = async () => {
    try {
      const { data: walletData, error: walletError } = await supabase.from('user_wallet').select('coins').eq('user_name', userName);
      const cost = 10;
      if (walletError || !walletData || walletData.length === 0 || walletData[0].coins < cost) {
        Alert.alert('Monedas insuficientes', 'Necesitas 10 monedas (🪙) para saltear la canción.');
        return;
      }
      await supabase.from('user_wallet').update({ coins: walletData[0].coins - cost }).eq('user_name', userName);
      Alert.alert('⏭️ ¡Salto aplicado!', 'Se han descontado 10 monedas.');
    } catch (err) {
      Alert.alert('Error', 'No se pudo saltear la canción.');
    }
  };

  return (
    <View style={spotifyStyles.playerCard}>
      <View style={spotifyStyles.albumArt}><Text style={{ fontSize: 18 }}>🎧</Text></View>
      <View style={spotifyStyles.trackInfo}>
        <Text style={spotifyStyles.trackTitle} numberOfLines={1}>{currentSongData.name}</Text>
        <Text style={spotifyStyles.trackArtist}>{isConnected ? '🟢 Conectado' : '🔴 Desconectado'}</Text>
      </View>
      <View style={spotifyStyles.controlsRow}>
        <Pressable style={[spotifyStyles.connectButton, isConnected ? { backgroundColor: '#ef4444' } : { backgroundColor: '#1db954' }]} onPress={toggleConnection}>
          <Text style={spotifyStyles.btnText}>{isConnected ? 'Desconectar' : 'Conectarse'}</Text>
        </Pressable>
        <Pressable style={spotifyStyles.coinButton} onPress={() => { loadSongSuggestions(); setModalVisible(true); }}>
          <Text style={spotifyStyles.coinButtonText}>+1 🪙</Text>
        </Pressable>
        <Pressable style={spotifyStyles.skipButton} onPress={handleSkipSong}>
          <Text style={spotifyStyles.skipButtonText}>Saltear (10 🪙)</Text>
        </Pressable>
      </View>

      <Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={spotifyStyles.modalOverlay}>
          <View style={spotifyStyles.modalContent}>
            <Text style={spotifyStyles.modalTitle}>🎵 Pedir Canción por Nombre</Text>
            <Text style={spotifyStyles.modalSub}>Costo: 1 Moneda (🪙)</Text>
            <TextInput style={spotifyStyles.input} placeholder="Ej: Queen - Bohemian Rhapsody" placeholderTextColor="#64748b" value={songInput} onChangeText={handleTextChange} />
            {suggestions.length > 0 && (
              <ScrollView style={spotifyStyles.suggestionsContainer} nestedScrollEnabled={true}>
                {suggestions.map((item, index) => (
                  <Pressable key={index} style={spotifyStyles.suggestionItem} onPress={() => { setSongInput(item); setSuggestions([]); }}>
                    <Text style={spotifyStyles.suggestionText}>{item}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={spotifyStyles.modalButtons}>
              <Pressable style={[spotifyStyles.modalBtn, { backgroundColor: '#334155' }]} onPress={() => { setModalVisible(false); setSuggestions([]); }}>
                <Text style={spotifyStyles.modalBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[spotifyStyles.modalBtn, { backgroundColor: '#f59e0b' }]} onPress={handleAddSongToQueue} disabled={loading}>
                <Text style={spotifyStyles.modalBtnText}>{loading ? 'Procesando...' : 'Anotar (1 🪙)'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
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

  const [userStreak, setUserStreak] = useState(0);
  const [showMenu, setShowMenu] = useState(false);

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [screamerActive, setScreamerActive] = useState(false);
  const [screamerData, setScreamerData] = useState<{ image: any; isSurprise: boolean } | null>(null);

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

    if (!error && data) {
      setNotifications(data);
      const unread = data.filter((n) => !n.read).length;
      setUnreadCount(unread);
    }
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

  const marcarNotificacionesComoLeidas = useCallback(async () => {
    if (!authUserName) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_name', authUserName)
        .eq('read', false);

      if (error) throw error;
      setUnreadCount(0);
    } catch (error) {
      console.log("Error al marcar notificaciones:", error);
    }
  }, [authUserName]);

  const checkAndTriggerScreamer = async (userName: string) => {
    try {
      const { data, error } = await supabase
        .from('pending_punishments')
        .select('*')
        .eq('target_user', userName)
        .eq('triggered', false)
        .limit(1)
        .maybeSingle();

      if (error || !data) return;

      await supabase
        .from('pending_punishments')
        .update({ triggered: true })
        .eq('id', data.id);

      const isSurprise = Math.random() < 0.01;
      let selectedImage;
      if (isSurprise) {
        selectedImage = require('../../assets/job.png'); 
      } else {
        const normalPhotos = [
          require('../../assets/susto1.jpg'),
          require('../../assets/susto2.jpeg'),
          require('../../assets/susto3.jpeg'),
        ];
        selectedImage = normalPhotos[Math.floor(Math.random() * normalPhotos.length)];
      }

      setScreamerData({ image: selectedImage, isSurprise });
      setScreamerActive(true);
    } catch (err) {
      console.error('Error sustos:', err);
    }
  };

  useEffect(() => {
    const restoreSession = async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        setAuthUserName(saved);
        setIsLoggedIn(true);
        await checkAndRegisterPushToken(saved);
        await fetchUserStreak(saved);
        await checkAndTriggerScreamer(saved);
      }
    };
    restoreSession();
  }, [fetchUserStreak]);

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
          setNotifications((prev) => {
            const updated = [payload.new as NotificationRow, ...prev].slice(0, 10);
            setUnreadCount(updated.filter((n) => !n.read).length);
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUserName, fetchNotifications, fetchUserStreak]);

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
          Alert.alert('📢 Aviso del Admin', newMessage.message);
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
          await fetchUserStreak(name);
          await checkAndRegisterPushToken(name);
          await checkAndTriggerScreamer(name);
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
        await fetchUserStreak(name);
        await registerForPushNotificationsAsync(name);
      }
    } catch (err) {
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
      await checkAndTriggerScreamer(authUserName);
      Alert.alert('Check-in registrado', `${authUserName} ya quedó activo.`);
    } catch (error) {
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

              <Pressable 
                style={styles.bellButton} 
                onPress={() => {
                  const willShow = !showNotificationsModal;
                  setShowNotificationsModal(willShow);
                  if (willShow) {
                    marcarNotificacionesComoLeidas();
                  }
                }}
              >
                <Text style={{ fontSize: 20 }}>🔔</Text>
                {unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>

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

            <MobileMusicPlayer userName={authUserName} />

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

      {screamerActive && screamerData && (
        <View style={styles.screamerOverlay}>
          <Image 
            source={screamerData.image} 
            style={styles.screamerImage} 
            resizeMode="cover"
          />
          <Text style={styles.screamerTitle}>
            {screamerData.isSurprise ? '😱 ¡¡SORPRESA TERRORÍFICA (1 en 100)!! 😱' : '👻 ¡Te han mandado un susto! 👻'}
          </Text>
          <Pressable 
            style={styles.screamerButton} 
            onPress={() => setScreamerActive(false)}
          >
            <Text style={styles.screamerButtonText}>¡Cerrar susto!</Text>
          </Pressable>
        </View>
      )}
      
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

const spotifyStyles = StyleSheet.create({
  playerCard: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#27272a',
    flexDirection: 'row',
    alignItems: 'center',
  },
  albumArt: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  trackInfo: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 4,
  },
  trackTitle: {
    color: '#f4f4f5',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  trackArtist: {
    color: '#a1a1aa',
    fontSize: 10,
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButton: {
    backgroundColor: '#27272a',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  coinButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  skipButtonText: {
    color: '#f4f4f5',
    fontSize: 10,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1f2937',
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSub: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 4,
  },
  suggestionsContainer: {
    maxHeight: 120,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    marginBottom: 12,
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  suggestionText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

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
  screamerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
    padding: 20,
  },
  screamerImage: {
    width: '100%',
    height: '60%',
    borderRadius: 15,
    marginBottom: 20,
  },
  screamerTitle: {
    color: '#ef4444',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  screamerButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
  },
  screamerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
});