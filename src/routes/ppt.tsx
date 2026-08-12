import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'horasbiblio_user_name';

async function sendPushNotification(expoPushToken: string, title: string, body: string) {
  if (!expoPushToken) return;
  const message = { to: expoPushToken, sound: 'default', title: title, body: body, data: { someData: 'goes here' } };
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch (e) { console.log('Error enviando push notification:', e); }
}

export default function VersusScreen() {
  const [userName, setUserName] = useState('');
  const [coins, setCoins] = useState(0);
  const [opponentName, setOpponentName] = useState('');
  const [betAmount, setBetAmount] = useState('10');
  const [activeDuel, setActiveDuel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const init = async () => {
      const savedName = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedName) {
        setUserName(savedName);
        await loadWallet(savedName);
        checkActiveDuels(savedName);
      }
      setLoading(false);
    };
    init();
  }, []);

  const loadWallet = async (name: string) => {
    const { data } = await supabase.from('user_wallet').select('coins').eq('user_name', name).maybeSingle();
    if (data) setCoins(data.coins || 0);
  };

  const checkActiveDuels = async (name: string) => {
    const { data } = await supabase
      .from('ppt_duels')
      .select('*')
      .or(`challenger.eq.${name},opponent.eq.${name}`)
      .neq('status', 'finished')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) setActiveDuel(data);
  };

  useEffect(() => {
    if (!userName) return;
    const channel = supabase
      .channel('public:ppt_duels')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ppt_duels' },
        (payload) => {
          const newRecord = payload.new as any;
          if (newRecord.challenger === userName || newRecord.opponent === userName) {
            setActiveDuel(newRecord);
            loadWallet(userName);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userName]);

  const handleSearchUsers = async (text: string) => {
    setOpponentName(text);
    if (text.trim().length === 0) {
      setShowSuggestions(false);
      return;
    }
    const { data } = await supabase.from('user_wallet').select('user_name').ilike('user_name', `%${text}%`).limit(5);
    if (data) {
      const names = data.map(i => i.user_name).filter(n => n.toLowerCase() !== userName.toLowerCase());
      setSuggestions(names);
      setShowSuggestions(names.length > 0);
    }
  };

  const handleCreateDuel = async () => {
    setErrorMsg('');
    const amount = parseFloat(betAmount);
    const target = opponentName.trim();

    if (!target) {
      setErrorMsg('⚠️ Ingresa el nombre del rival.');
      return;
    }
    if (target.toLowerCase() === userName.toLowerCase()) {
      setErrorMsg('⚠️ No puedes retarte a ti mismo.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg('⚠️ Ingresa una cantidad de monedas válida.');
      return;
    }
    if (coins < amount) {
      setErrorMsg('⚠️ No tienes suficientes monedas para esta apuesta.');
      return;
    }

    const newCoins = coins - amount;
    const { error: walletErr } = await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);
    
    if (walletErr) {
      setErrorMsg('❌ Error al actualizar tus monedas.');
      return;
    }
    setCoins(newCoins);

    // Al no tener columna bet en la tabla, guardamos el monto de la apuesta concatenado o en el winner/status de manera lógica,
    // o simplemente creamos el registro usando los campos exactos de tu esquema.
    const { data, error } = await supabase
      .from('ppt_duels')
      .insert({
        challenger: userName,
        opponent: target,
        status: String(amount) // Guardamos temporalmente el monto de la apuesta en el campo status (ej: 'pending:10')
      })
      .select()
      .single();

    if (!error && data) {
      setActiveDuel(data);

      await supabase.from('notifications').insert({
        user_name: target,
        message: `⚔️ ¡${userName} te ha retado a un duelo de PPT por ${amount} monedas!`
      });

      const { data: opponentWallet } = await supabase
        .from('user_wallet')
        .select('expo_push_token')
        .eq('user_name', target)
        .maybeSingle();

      if (opponentWallet?.expo_push_token) {
        await sendPushNotification(
          opponentWallet.expo_push_token,
          '¡Nuevo Duelo ⚔️!',
          `${userName} te ha retado a un duelo por ${amount} monedas.`
        );
      }
    } else {
      console.error('Error insertando duelo:', error);
      setErrorMsg('❌ Error al crear el duelo en la base de datos.');
      await supabase.from('user_wallet').update({ coins: coins }).eq('user_name', userName);
      setCoins(coins);
    }
  };

  const handleMakeChoice = async (choice: 'rock' | 'paper' | 'scissors') => {
    if (!activeDuel) return;
    const isChallenger = activeDuel.challenger === userName;
    
    // Extraemos la apuesta del string de estado (ej: 'pending:10' -> 10)
    const statusParts = (activeDuel.status || 'pending:10').split(':');
    const bet = parseFloat(statusParts[1]) || 10;

    if (!isChallenger && !activeDuel.opponent_choice) {
      if (coins < bet) {
        setErrorMsg('⚠️ No tienes suficientes monedas para igualar la apuesta.');
        return;
      }
      const newCoins = coins - bet;
      await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);
      setCoins(newCoins);
    }

    const updateField = isChallenger ? { challenger_choice: choice } : { opponent_choice: choice };
    const rivalChoice = isChallenger ? activeDuel.opponent_choice : activeDuel.challenger_choice;
    
    let newStatus = activeDuel.status;
    let winner = null;

    if (rivalChoice) {
      newStatus = 'finished';
      winner = calculateWinner(
        isChallenger ? choice : rivalChoice,
        isChallenger ? rivalChoice : choice,
        activeDuel.challenger,
        activeDuel.opponent
      );

      const totalPot = bet * 2;
      if (winner !== 'Empate') {
        const { data: winnerWallet } = await supabase.from('user_wallet').select('coins').eq('user_name', winner).single();
        if (winnerWallet) {
          await supabase.from('user_wallet').update({ coins: (winnerWallet.coins || 0) + totalPot }).eq('user_name', winner);
        }
      } else {
        const { data: cWallet } = await supabase.from('user_wallet').select('coins').eq('user_name', activeDuel.challenger).single();
        const { data: oWallet } = await supabase.from('user_wallet').select('coins').eq('user_name', activeDuel.opponent).single();
        
        if (cWallet) await supabase.from('user_wallet').update({ coins: (cWallet.coins || 0) + bet }).eq('user_name', activeDuel.challenger);
        if (oWallet) await supabase.from('user_wallet').update({ coins: (oWallet.coins || 0) + bet }).eq('user_name', activeDuel.opponent);
      }
      loadWallet(userName);
    }

    const { data, error } = await supabase
      .from('ppt_duels')
      .update({ ...updateField, status: newStatus, winner })
      .eq('id', activeDuel.id)
      .select()
      .single();

    if (!error && data) {
      setActiveDuel(data);
    }
  };

  const calculateWinner = (p1Choice: string, p2Choice: string, p1Name: string, p2Name: string) => {
    if (p1Choice === p2Choice) return 'Empate';
    if (
      (p1Choice === 'rock' && p2Choice === 'scissors') ||
      (p1Choice === 'paper' && p2Choice === 'rock') ||
      (p1Choice === 'scissors' && p2Choice === 'paper')
    ) {
      return p1Name;
    }
    return p2Name;
  };

  const currentBet = activeDuel ? parseFloat((activeDuel.status || '').split(':')[1]) || 10 : 10;

  if (loading) return <View style={styles.center}><ActivityIndicator color="#f59e0b" size="large" /></View>;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>⚔️ Duelo Multijugador (PPT)</Text>
      <Text style={styles.balanceText}>🪙 Tus Monedas: {coins.toFixed(1)}</Text>

      {!activeDuel ? (
        <View style={styles.card}>
          <Text style={styles.label}>Retar a un usuario:</Text>
          <View style={{ position: 'relative', zIndex: 99 }}>
            <TextInput
              style={styles.input}
              placeholder="Nombre del rival"
              placeholderTextColor="#64748b"
              value={opponentName}
              onChangeText={handleSearchUsers}
            />
            {showSuggestions && (
              <View style={styles.suggestionsContainer}>
                {suggestions.map((item, idx) => (
                  <Pressable key={idx} style={styles.suggestionItem} onPress={() => { setOpponentName(item); setShowSuggestions(false); }}>
                    <Text style={{ color: '#f8fafc' }}>👤 {item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Text style={styles.label}>Monedas a apostar:</Text>
          <TextInput
            style={styles.input}
            placeholder="Cantidad"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            value={betAmount}
            onChangeText={setBetAmount}
          />

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <Pressable style={styles.button} onPress={handleCreateDuel}>
            <Text style={styles.buttonText}>Lanzar Reto con Apuesta 🚀</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.vsText}>{activeDuel.challenger} vs {activeDuel.opponent}</Text>
          <Text style={styles.betInfo}>💰 Pozo en juego: {currentBet * 2} Monedas ({currentBet} c/u)</Text>
          
          {activeDuel.status !== 'finished' ? (
            <View>
              <Text style={styles.subLabel}>Elige tu arma:</Text>
              <View style={styles.choicesRow}>
                <Pressable style={styles.choiceBtn} onPress={() => handleMakeChoice('rock')}><Text style={styles.choiceText}>🪨 Piedra</Text></Pressable>
                <Pressable style={styles.choiceBtn} onPress={() => handleMakeChoice('paper')}><Text style={styles.choiceText}>📄 Papel</Text></Pressable>
                <Pressable style={styles.choiceBtn} onPress={() => handleMakeChoice('scissors')}><Text style={styles.choiceText}>✂️ Tijera</Text></Pressable>
              </View>
              <Text style={styles.waitingText}>
                {((activeDuel.challenger === userName && activeDuel.challenger_choice) || (activeDuel.opponent === userName && activeDuel.opponent_choice))
                  ? 'Esperando la jugada del rival...' 
                  : '¡Haz tu elección! (Se descontará tu apuesta)'}
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.resultTitle}>🏁 Duelo Finalizado</Text>
              <Text style={styles.meta}>Jugada de {activeDuel.challenger}: {activeDuel.challenger_choice}</Text>
              <Text style={styles.meta}>Jugada de {activeDuel.opponent}: {activeDuel.opponent_choice}</Text>
              <Text style={styles.winnerAnnounce}>
                🏆 Ganador: {activeDuel.winner === 'Empate' ? '¡Empate (Se devuelven apuestas)!' : `${activeDuel.winner} (+${currentBet * 2} 🪙)`}
              </Text>
              <Pressable style={[styles.button, { marginTop: 20 }]} onPress={() => setActiveDuel(null)}>
                <Text style={styles.buttonText}>Nuevo Duelo</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0f172a', flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  balanceText: { color: '#fbbf24', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  card: { backgroundColor: '#111827', padding: 18, borderRadius: 16, borderWidth: 1, borderColor: '#1f2937' },
  label: { color: '#cbd5e1', fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  subLabel: { color: '#cbd5e1', fontSize: 15, fontWeight: '700', textAlign: 'center', marginVertical: 15 },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, backgroundColor: '#0f172a', color: '#f8fafc', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  button: { backgroundColor: '#f59e0b', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#0f172a', fontWeight: '900', fontSize: 15 },
  vsText: { color: '#fbbf24', fontSize: 18, fontWeight: '900', textAlign: 'center', marginBottom: 5 },
  betInfo: { color: '#38bdf8', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 15 },
  choicesRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10 },
  choiceBtn: { backgroundColor: '#1e293b', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  choiceText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  waitingText: { color: '#94a3b8', textAlign: 'center', marginTop: 15, fontStyle: 'italic', fontSize: 13 },
  resultTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  meta: { color: '#94a3b8', fontSize: 14, marginVertical: 2 },
  winnerAnnounce: { color: '#10b981', fontSize: 16, fontWeight: '900', marginTop: 15, textAlign: 'center' },
  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  suggestionsContainer: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', zIndex: 999 },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#334155' }
});