import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Animated,
  Easing,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'horasbiblio_user_name';

export default function MinijuegoScreen() {
  const [userName, setUserName] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [nameError, setNameError] = useState('');

  const [coins, setCoins] = useState(0);
  const [betAmount, setBetAmount] = useState(10);
  const [betChoice, setBetChoice] = useState<'rojo' | 'verde' | 'negro'>('rojo');
  const [spinning, setSpinning] = useState(false);
  const [suspenseText, setSuspenseText] = useState('HAZ TU APUESTA');
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [resultType, setResultType] = useState<'win' | 'jackpot' | 'lose' | null>(null);

  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const checkLocalUser = async () => {
      const savedName = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedName) {
        setUserName(savedName);
        setHasStarted(true);
        fetchUserWallet(savedName);
      }
    };
    checkLocalUser();
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const fetchUserWallet = async (name: string) => {
    const { data } = await supabase
      .from('user_wallet')
      .select('coins')
      .eq('user_name', name)
      .maybeSingle();

    if (data) {
      setCoins(data.coins || 0);
    }
  };

  const handleStartGame = async () => {
    const name = userName.trim();
    setNameError('');

    if (!name) {
      setNameError('Ingresa tu nombre.');
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
        await AsyncStorage.setItem(STORAGE_KEY, name);
        setHasStarted(true);
        setCoins(data.coins || 0);
      } else {
        const { error: insertError } = await supabase
          .from('user_wallet')
          .insert({ user_name: name, coins: 0 });

        if (insertError) throw insertError;

        await AsyncStorage.setItem(STORAGE_KEY, name);
        setHasStarted(true);
        setCoins(0);
      }
    } catch (err) {
      console.error(err);
      setNameError('❌ Error de conexión al validar usuario.');
    }
  };

  const spinRoulette = async () => {
    if (coins < betAmount) {
      Alert.alert('Saldo insuficiente', 'No tienes suficientes monedas.');
      return;
    }

    setSpinning(true);
    setLastResult(null);
    setResultType(null);
    
    const newCoins = coins - betAmount;
    setCoins(newCoins);
    await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);

    setSuspenseText('⚡ ¡GIRANDO A MÁXIMA VELOCIDAD!');
    setTimeout(() => setSuspenseText('🔥 Frenando la bolilla...'), 900);

    const roll = Math.random() * 100;
    let colorGanador: 'rojo' | 'negro' | 'verde' = 'rojo';

    if (roll < 48) colorGanador = 'rojo';
    else if (roll < 96) colorGanador = 'negro';
    else colorGanador = 'verde';

    let randomExtraDeg = 0;
    if (colorGanador === 'rojo') {
      randomExtraDeg = Math.floor(Math.random() * 100) + 20;
    } else if (colorGanador === 'negro') {
      randomExtraDeg = Math.floor(Math.random() * 100) + 140;
    } else {
      randomExtraDeg = Math.floor(Math.random() * 20) + 265; 
    }

    const totalVueltas = 360 * 12; 
    const targetAngle = totalVueltas + randomExtraDeg;

    spinValue.setValue(0);
    Animated.timing(spinValue, {
      toValue: targetAngle,
      duration: 1500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    setTimeout(async () => {
      let finalCoins = newCoins;
      if (colorGanador === betChoice) {
        const subRoll = Math.random() * 100;
        
        if (colorGanador === 'verde') {
          if (subRoll <= 5) {
            const premio = betAmount * 50;
            finalCoins += premio;
            setLastResult(`🔥 ¡VERDE PLUS LEGENDARIO! ¡Se activó el 5% interno! Ganaste x50 = ${premio} monedas.`);
            setResultType('jackpot');
          } else {
            const premio = betAmount * 5;
            finalCoins += premio;
            setLastResult(`🟢 ¡VICTORIA VERDE! Salió VERDE y ganaste ${premio} monedas (x5).`);
            setResultType('win');
          }
        } else {
          const premio = betAmount * 1.5;
          finalCoins += premio;
          setLastResult(`🟢 ¡VICTORIA! Salió ${colorGanador.toUpperCase()}. Acertaste y ganaste ${premio} monedas (x1.5).`);
          setResultType('win');
        }
      } else {
        setLastResult(`🔴 Salió ${colorGanador.toUpperCase()}. La casa gana esta vez.`);
        setResultType('lose');
      }

      setCoins(finalCoins);
      await supabase.from('user_wallet').update({ coins: finalCoins }).eq('user_name', userName);

      setSuspenseText('¡RESULTADO DEFINIDO!');
      setSpinning(false);
    }, 1500);
  };

  const spinInterpolate = spinValue.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  if (!hasStarted) {
    return (
      <View style={styles.loginContainer}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🎰 Ingresa al Juego</Text>
          <Text style={styles.subtitle}>Introduce tu nombre para continuar</Text>

          <TextInput
            style={styles.input}
            placeholder="Tu nombre exacto"
            placeholderTextColor="#64748b"
            value={userName}
            onChangeText={setUserName}
            autoCapitalize="words"
          />

          {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

          <Pressable style={styles.spinButton} onPress={handleStartGame}>
            <Text style={styles.spinButtonText}>Entrar a Jugar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appTitle}>🎰 ROULETTE ROYALE</Text>
          <Text style={styles.userSub}>Jugador: <Text style={{ color: '#f59e0b' }}>{userName}</Text></Text>
        </View>
        <Animated.View style={[styles.coinBadge, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.coinText}>🪙 {coins.toFixed(1)}</Text>
        </Animated.View>
      </View>

      {/* RULETA REAL CON IMAGEN */}
      <View style={styles.wheelContainer}>
        <View style={styles.wheelOuterRing}>
          <View style={styles.wheelPointerIndicator} />
          <Animated.View style={[styles.rouletteWheel, { transform: [{ rotate: spinInterpolate }] }]}>
            
            <Image 
              source={require('../../assets/ruleta.jpeg')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />

            <View style={styles.wheelCenterCore}>
              <View style={styles.wheelCrossHoriz} />
              <View style={styles.wheelCrossVert} />
            </View>

          </Animated.View>
        </View>
      </View>

      <View style={styles.suspenseBox}>
        <Text style={styles.suspenseTextHeader}>{suspenseText}</Text>
      </View>

      {lastResult ? (
        <View style={[
          styles.resultBox, 
          resultType === 'jackpot' && styles.resJackpot,
          resultType === 'win' && styles.resWin,
          resultType === 'lose' && styles.resLose,
        ]}>
          <Text style={styles.resultText}>{lastResult}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>1. Elige tu zona de apuesta (48% / 2% / 48%):</Text>
        <View style={styles.row}>
          <Pressable 
            style={[styles.choiceBtn, betChoice === 'rojo' && styles.rojoActive]} 
            onPress={() => setBetChoice('rojo')}
          >
            <Text style={styles.choiceTextEmoji}>🔴</Text>
            <Text style={styles.choiceText}>ROJO (x1.5)</Text>
          </Pressable>

          <Pressable 
            style={[styles.choiceBtn, betChoice === 'verde' && styles.verdeActive]} 
            onPress={() => setBetChoice('verde')}
          >
            <Text style={styles.choiceTextEmoji}>🟢</Text>
            <Text style={styles.choiceText}>VERDE (x5 / x50)</Text>
          </Pressable>

          <Pressable 
            style={[styles.choiceBtn, betChoice === 'negro' && styles.negroActive]} 
            onPress={() => setBetChoice('negro')}
          >
            <Text style={styles.choiceTextEmoji}>⚫</Text>
            <Text style={styles.choiceText}>NEGRO (x1.5)</Text>
          </Pressable>
        </View>

        <Text style={[styles.label, { marginTop: 18 }]}>2. Selecciona tus fichas:</Text>
        <View style={styles.row}>
          {[5, 10, 25, 50].map((val) => (
            <Pressable
              key={val}
              style={[styles.chipBtn, betAmount === val && styles.chipActive]}
              onPress={() => setBetAmount(val)}
            >
              <Text style={styles.chipText}>{val}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable 
          style={[styles.spinButton, spinning && styles.disabled]} 
          onPress={spinRoulette}
          disabled={spinning}
        >
          {spinning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.spinButtonText}>🔥 LANZAR APUESTA ({betAmount} 🪙)</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#090d16', flexGrow: 1 },
  loginContainer: { flex: 1, backgroundColor: '#090d16', justifyContent: 'center', padding: 20 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  appTitle: { color: '#f8fafc', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  userSub: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  coinBadge: { backgroundColor: '#1e1b4b', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, borderWidth: 2, borderColor: '#f59e0b', shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10 },
  coinText: { color: '#fbbf24', fontWeight: '900', fontSize: 16 },
  
  wheelContainer: { alignItems: 'center', justifyContent: 'center', marginVertical: 14 },
  wheelOuterRing: { width: 190, height: 190, borderRadius: 95, backgroundColor: '#78350f', borderWidth: 6, borderColor: '#b45309', alignItems: 'center', justifyContent: 'center', shadowColor: '#b45309', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 12 },
  wheelPointerIndicator: { position: 'absolute', top: -4, width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid', borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ef4444', zIndex: 30 },
  rouletteWheel: { width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: '#fbbf24', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  wheelCenterCore: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#92400e', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fbbf24', position: 'absolute', zIndex: 15 },
  wheelCrossHoriz: { position: 'absolute', width: '100%', height: 3, backgroundColor: '#fbbf24' },
  wheelCrossVert: { position: 'absolute', width: 3, height: '100%', backgroundColor: '#fbbf24' },

  suspenseBox: { alignItems: 'center', marginVertical: 10 },
  suspenseTextHeader: { color: '#38bdf8', fontSize: 14, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  resultBox: { padding: 16, borderRadius: 14, marginBottom: 20, borderWidth: 2, alignItems: 'center', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  resJackpot: { backgroundColor: '#451a03', borderColor: '#f59e0b', shadowColor: '#f59e0b' },
  resWin: { backgroundColor: '#064e3b', borderColor: '#10b981', shadowColor: '#10b981' },
  resLose: { backgroundColor: '#7f1d1d', borderColor: '#ef4444', shadowColor: '#ef4444' },
  resultText: { color: '#f8fafc', textAlign: 'center', fontWeight: '800', fontSize: 15 },
  card: { backgroundColor: '#111827', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1f2937', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sectionTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '900', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  label: { color: '#cbd5e1', fontWeight: '700', fontSize: 13, marginBottom: 10, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 12, backgroundColor: '#0f172a', color: '#f8fafc', paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, marginBottom: 14, marginTop: 6 },
  errorText: { color: '#ef4444', fontSize: 13, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  choiceBtn: { flex: 1, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12, backgroundColor: '#1e293b', alignItems: 'center', borderWidth: 2, borderColor: '#334155', flexDirection: 'column', justifyContent: 'center', gap: 2 },
  rojoActive: { backgroundColor: '#7f1d1d', borderColor: '#ef4444', shadowColor: '#ef4444', shadowOpacity: 0.8, shadowRadius: 8 },
  negroActive: { backgroundColor: '#18181b', borderColor: '#71717a', shadowColor: '#71717a', shadowOpacity: 0.8, shadowRadius: 8 },
  verdeActive: { backgroundColor: '#064e3b', borderColor: '#10b981', shadowColor: '#10b981', shadowOpacity: 0.8, shadowRadius: 8 },
  choiceTextEmoji: { fontSize: 14 },
  choiceText: { color: '#fff', fontWeight: '900', fontSize: 10, textAlign: 'center' },
  chipBtn: { flex: 1, paddingVertical: 12, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  chipActive: { backgroundColor: '#f59e0b', borderColor: '#fbbf24', shadowColor: '#f59e0b', shadowOpacity: 0.8, shadowRadius: 6 },
  chipText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  spinButton: { marginTop: 10, backgroundColor: '#f59e0b', paddingVertical: 16, borderRadius: 14, alignItems: 'center', shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 10 },
  spinButtonText: { color: '#090d16', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  disabled: { opacity: 0.6 },
});