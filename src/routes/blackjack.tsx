import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'horasbiblio_user_name';

type Card = {
  suit: '♠' | '♥' | '♦' | '♣';
  value: string;
  numericValue: number;
};

export default function BlackjackScreen() {
  const [userName, setUserName] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [nameError, setNameError] = useState('');

  const [coins, setCoins] = useState(0);
  const [betAmount, setBetAmount] = useState(10);
  const [gameStarted, setGameStarted] = useState(false);
  const [loading, setLoading] = useState(false);

  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [gameMessage, setGameMessage] = useState('Apuesta y presiona "Repartir"');
  const [gameOver, setGameOver] = useState(true);

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

  const createDeck = (): Card[] => {
    const suits: ('♠' | '♥' | '♦' | '♣')[] = ['♠', '♥', '♦', '♣'];
    const values = [
      { v: '2', n: 2 }, { v: '3', n: 3 }, { v: '4', n: 4 }, { v: '5', n: 5 },
      { v: '6', n: 6 }, { v: '7', n: 7 }, { v: '8', n: 8 }, { v: '9', n: 9 },
      { v: '10', n: 10 }, { v: 'J', n: 10 }, { v: 'Q', n: 10 }, { v: 'K', n: 10 },
      { v: 'A', n: 11 }
    ];

    let deck: Card[] = [];
    for (const suit of suits) {
      for (const val of values) {
        deck.push({ suit, value: val.v, numericValue: val.n });
      }
    }
    // Mezclar mazo
    return deck.sort(() => Math.random() - 0.5);
  };

  const calculateHandScore = (hand: Card[]): number => {
    let score = 0;
    let aces = 0;

    for (const card of hand) {
      score += card.numericValue;
      if (card.value === 'A') aces += 1;
    }

    while (score > 21 && aces > 0) {
      score -= 10;
      aces -= 1;
    }

    return score;
  };

  const startRound = async () => {
    if (coins < betAmount) {
      Alert.alert('Saldo insuficiente', 'No tienes suficientes monedas para esta apuesta.');
      return;
    }

    setLoading(true);
    const newCoins = coins - betAmount;
    setCoins(newCoins);
    await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);

    const deck = createDeck();
    const pHand = [deck.pop()!, deck.pop()!];
    const dHand = [deck.pop()!, deck.pop()!];

    setPlayerHand(pHand);
    setDealerHand(dHand);
    setGameStarted(true);
    setGameOver(false);
    setLoading(false);

    const pScore = calculateHandScore(pHand);
    if (pScore === 21) {
      setGameMessage('🔥 ¡BLACKJACK NATURAL! Turno de la casa...');
      setTimeout(() => evaluateDealerTurn(pHand, dHand, newCoins), 1000);
    } else {
      setGameMessage('Tu turno: ¿Pedir (Hit) o Plantarse (Stand)?');
    }
  };

  const hit = () => {
    if (gameOver) return;
    const deck = createDeck();
    const newCard = deck.pop()!;
    const newHand = [...playerHand, newCard];
    setPlayerHand(newHand);

    const score = calculateHandScore(newHand);
    if (score > 21) {
      setGameOver(true);
      setGameMessage('💥 ¡Te pasaste de 21! La casa gana.');
    } else if (score === 21) {
      stand(newHand);
    }
  };

  const stand = (currentPHand = playerHand) => {
    if (gameOver) return;
    evaluateDealerTurn(currentPHand, dealerHand, coins);
  };

  const evaluateDealerTurn = async (pHand: Card[], dHand: Card[], currentCoins: number) => {
    setGameOver(true);
    let dScore = calculateHandScore(dHand);
    let currentDHand = [...dHand];

    const deck = createDeck();
    while (dScore < 17) {
      currentDHand.push(deck.pop()!);
      dScore = calculateHandScore(currentDHand);
    }
    setDealerHand(currentDHand);

    const pScore = calculateHandScore(pHand);

    let finalCoins = currentCoins;
    let message = '';

    if (pScore > 21) {
      message = '💥 Te pasaste de 21. Perdiste la apuesta.';
    } else if (dScore > 21) {
      const winAmount = betAmount * 2;
      finalCoins += winAmount;
      message = `🎉 ¡La casa se pasó de 21! Ganaste ${winAmount} monedas.`;
    } else if (pScore > dScore) {
      const winAmount = betAmount * 2;
      finalCoins += winAmount;
      message = `🏆 ¡Victoria! Tienes ${pScore} frente a ${dScore} de la casa. Ganaste ${winAmount} monedas.`;
    } else if (pScore < dScore) {
      message = `😢 Derrota. La casa ganó con ${dScore} frente a tus ${pScore}.`;
    } else {
      finalCoins += betAmount; // Empate, devuelve la apuesta
      message = `🤝 Empate (Push). Se te devuelven tus ${betAmount} monedas.`;
    }

    setCoins(finalCoins);
    setGameMessage(message);
    await supabase.from('user_wallet').update({ coins: finalCoins }).eq('user_name', userName);
  };

  if (!hasStarted) {
    return (
      <View style={styles.loginContainer}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🃏 Ingresa al Blackjack</Text>
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

          <Pressable style={styles.actionButton} onPress={handleStartGame}>
            <Text style={styles.actionButtonText}>Entrar a Jugar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appTitle}>🃏 BLACKJACK 21</Text>
          <Text style={styles.userSub}>Jugador: <Text style={{ color: '#f59e0b' }}>{userName}</Text></Text>
        </View>
        <View style={styles.coinBadge}>
          <Text style={styles.coinText}>🪙 {coins.toFixed(1)}</Text>
        </View>
      </View>

      <View style={styles.tableContainer}>
        {/* Dealer Area */}
        <View style={styles.dealerSection}>
          <Text style={styles.sectionHeader}>
            Mano de la Casa {gameOver ? `(${calculateHandScore(dealerHand)})` : '(Oculta)'}
          </Text>
          <View style={styles.cardsRow}>
            {dealerHand.map((card, idx) => (
              <View key={idx} style={[styles.cardItem, idx === 1 && !gameOver && styles.cardHidden]}>
                <Text style={styles.cardText}>
                  {idx === 1 && !gameOver ? '🂠' : `${card.value}${card.suit}`}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{gameMessage}</Text>
        </View>

        {/* Player Area */}
        <View style={styles.playerSection}>
          <Text style={styles.sectionHeader}>
            Tu Mano {playerHand.length > 0 && `(${calculateHandScore(playerHand)})`}
          </Text>
          <View style={styles.cardsRow}>
            {playerHand.map((card, idx) => (
              <View key={idx} style={styles.cardItem}>
                <Text style={styles.cardText}>{`${card.value}${card.suit}`}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.cardControl}>
        {!gameStarted || gameOver ? (
          <>
            <Text style={styles.label}>Selecciona tu apuesta:</Text>
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
              style={[styles.actionButton, loading && styles.disabled]}
              onPress={startRound}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#090d16" /> : <Text style={styles.actionButtonText}>🃏 REPARTIR CARTAS ({betAmount} 🪙)</Text>}
            </Pressable>
          </>
        ) : (
          <View style={styles.row}>
            <Pressable style={[styles.choiceBtn, styles.hitBtn]} onPress={hit}>
              <Text style={styles.btnText}>➕ Pedir (Hit)</Text>
            </Pressable>
            <Pressable style={[styles.choiceBtn, styles.standBtn]} onPress={() => stand()}>
              <Text style={styles.btnText}>🛑 Plantarse (Stand)</Text>
            </Pressable>
          </View>
        )}
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
  coinBadge: { backgroundColor: '#1e1b4b', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, borderWidth: 2, borderColor: '#f59e0b' },
  coinText: { color: '#fbbf24', fontWeight: '900', fontSize: 16 },

  tableContainer: { backgroundColor: '#064e3b', borderRadius: 20, padding: 16, borderWidth: 2, borderColor: '#047857', marginBottom: 16 },
  dealerSection: { marginBottom: 16, alignItems: 'center' },
  playerSection: { marginTop: 16, alignItems: 'center' },
  sectionHeader: { color: '#a7f3d0', fontSize: 13, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase' },
  cardsRow: { flexDirection: 'row', gap: 8 },
  cardItem: { width: 50, height: 75, backgroundColor: '#fff', borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  cardHidden: { backgroundColor: '#1e293b' },
  cardText: { fontSize: 18, fontWeight: '900', color: '#0f172a' },

  statusBox: { backgroundColor: '#022c22', padding: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#059669', marginVertical: 8 },
  statusText: { color: '#f8fafc', fontWeight: '800', fontSize: 14, textAlign: 'center' },

  cardControl: { backgroundColor: '#111827', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1f2937' },
  label: { color: '#cbd5e1', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  chipBtn: { flex: 1, paddingVertical: 12, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  chipActive: { backgroundColor: '#f59e0b', borderColor: '#fbbf24' },
  chipText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  actionButton: { marginTop: 12, backgroundColor: '#f59e0b', paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  actionButtonText: { color: '#090d16', fontWeight: '900', fontSize: 15, letterSpacing: 1 },

  choiceBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 2 },
  hitBtn: { backgroundColor: '#1e3a8a', borderColor: '#3b82f6' },
  standBtn: { backgroundColor: '#7f1d1d', borderColor: '#ef4444' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  disabled: { opacity: 0.6 },
  errorText: { color: '#ef4444', fontSize: 13, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 12, backgroundColor: '#0f172a', color: '#f8fafc', paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, marginBottom: 14, marginTop: 6 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  sectionTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '900', marginBottom: 4 },
  card: { backgroundColor: '#111827', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1f2937' },
});