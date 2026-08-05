import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert, ActivityIndicator, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'horasbiblio_user_name';

export default function ShopScreen() {
  const [userName, setUserName] = useState('');
  const [coins, setCoins] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [hoursToCoinsRate, setHoursToCoinsRate] = useState(10);
  const [coinsToHoursRate, setCoinsToHoursRate] = useState(15);
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados para transferencia y errores visuales
  const [recipientName, setRecipientName] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    const init = async () => {
      const savedName = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedName) {
        setUserName(savedName);
        await loadData(savedName);
      }
      setLoading(false);
    };
    init();
  }, []);

  const loadData = async (name: string) => {
    const { data: wallet } = await supabase
      .from('user_wallet')
      .select('coins')
      .eq('user_name', name)
      .maybeSingle();

    if (wallet) setCoins(wallet.coins || 0);

    const { data: sessionData } = await supabase
      .from('sesiones')
      .select('total_minutes, id')
      .eq('user_name', name);

    if (sessionData) {
      const totalMins = sessionData.reduce((acc, curr) => acc + (curr.total_minutes || 0), 0);
      setTotalMinutes(totalMins);
    }

    const { data: config } = await supabase.from('app_config').select('*');
    if (config) {
      const htc = config.find((c: any) => c.key === 'hours_to_coins_rate');
      const cth = config.find((c: any) => c.key === 'coins_to_hours_rate');
      if (htc) setHoursToCoinsRate(Number(htc.value));
      if (cth) setCoinsToHoursRate(Number(cth.value));
    }

    const { data: items } = await supabase.from('shop_items').select('*');
    if (items) setShopItems(items);
  };

  const handleConvertHoursToCoins = async () => {
    const minutesNeeded = 60;
    if (totalMinutes < minutesNeeded) {
      Alert.alert('Saldo insuficiente', 'Necesitas al menos 1 hora de estudio acumulada (60 min) para convertir.');
      return;
    }

    try {
      const { data: sessions, error: fetchErr } = await supabase
        .from('sesiones')
        .select('*')
        .eq('user_name', userName)
        .order('start_time', { ascending: true });

      if (fetchErr || !sessions) throw fetchErr;

      let remainingToSubtract = minutesNeeded;
      
      for (const sess of sessions) {
        if (remainingToSubtract <= 0) break;
        const currentMins = sess.total_minutes || 0;
        if (currentMins <= 0) continue;

        if (currentMins >= remainingToSubtract) {
          const newMins = currentMins - remainingToSubtract;
          await supabase.from('sesiones').update({ total_minutes: newMins }).eq('id', sess.id);
          remainingToSubtract = 0;
        } else {
          remainingToSubtract -= currentMins;
          await supabase.from('sesiones').update({ total_minutes: 0 }).eq('id', sess.id);
        }
      }

      const newCoins = coins + hoursToCoinsRate;
      
      await supabase
        .from('user_wallet')
        .update({ coins: newCoins })
        .eq('user_name', userName);

      setCoins(newCoins);
      setTotalMinutes(prev => prev - 60);
      Alert.alert('¡Intercambio exitoso!', `Convertiste 1 hora de estudio por ${hoursToCoinsRate} monedas 🪙.`);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo procesar el intercambio.');
    }
  };

  const handleConvertCoinsToHours = async () => {
    if (coins < coinsToHoursRate) {
      Alert.alert('Monedas insuficientes', `Necesitas ${coinsToHoursRate} monedas para comprar 1 hora.`);
      return;
    }

    try {
      const newCoins = coins - coinsToHoursRate;
      const nowIso = new Date().toISOString();

      const { error: walletErr } = await supabase
        .from('user_wallet')
        .update({ coins: newCoins })
        .eq('user_name', userName);

      if (walletErr) throw walletErr;

      const { error: sessionErr } = await supabase.from('sesiones').insert({
        user_name: userName,
        start_time: nowIso,
        end_time: nowIso,
        total_minutes: 60,
        last_seen: nowIso,
        multiplier: 1,
        event_name: "Compra en Tienda (Monedas ➔ Horas)",
      });

      if (sessionErr) throw sessionErr;

      setCoins(newCoins);
      setTotalMinutes(prev => prev + 60);
      Alert.alert('¡Compra exitosa!', `Canjeaste ${coinsToHoursRate} monedas por 1 hora (+60 min) sumada a tu perfil.`);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo completar la compra de horas.');
    }
  };

  // Transferencia con validación visual estricta
  const handleTransferCoins = async () => {
    const target = recipientName.trim();
    const amount = parseFloat(transferAmount);
    setTransferError(''); // Limpiar error visual anterior

    if (!target || !amount || isNaN(amount) || amount <= 0) {
      setTransferError('⚠️ Ingresa un usuario válido y un monto mayor a 0.');
      return;
    }

    if (target.toLowerCase() === userName.toLowerCase()) {
      setTransferError('⚠️ No puedes transferirte monedas a ti mismo.');
      return;
    }

    if (coins < amount) {
      setTransferError('⚠️ No tienes suficientes monedas para esta transferencia.');
      return;
    }

    setTransferring(true);
    try {
      // Verificamos si el destinatario existe en user_wallet
      const { data: recipientWallet, error: recipErr } = await supabase
        .from('user_wallet')
        .select('*')
        .eq('user_name', target)
        .maybeSingle();

      if (recipErr || !recipientWallet) {
        setTransferError(`❌ El usuario "${target}" no existe en el sistema.`);
        setTransferring(false);
        return;
      }

      // Procedemos con la transferencia
      const newSenderCoins = coins - amount;
      const newRecipientCoins = (recipientWallet.coins || 0) + amount;

      const { error: sendError } = await supabase
        .from('user_wallet')
        .update({ coins: newSenderCoins })
        .eq('user_name', userName);

      if (sendError) throw sendError;

      const { error: recipUpdateErr } = await supabase
        .from('user_wallet')
        .update({ coins: newRecipientCoins })
        .eq('user_name', target);

      if (recipUpdateErr) throw recipUpdateErr;

      setCoins(newSenderCoins);
      setRecipientName('');
      setTransferAmount('');
      Alert.alert('¡Transferencia exitosa!', `Has enviado ${amount} monedas 🪙 a ${target}.`);
    } catch (err) {
      console.error(err);
      setTransferError('❌ Error de red. Transacción cancelada.');
    } finally {
      setTransferring(false);
    }
  };

  const handleBuyItem = (item: any) => {
    if (coins < item.price) {
      Alert.alert('Monedas insuficientes', 'No tienes suficientes monedas para comprar este ítem.');
      return;
    }
    Alert.alert('Próximamente', `Estás a punto de adquirir: ${item.title}. Sistema de inventario en desarrollo.`);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  const hoursDisplay = Math.floor(totalMinutes / 60);
  const minsDisplay = totalMinutes % 60;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🛒 Tienda & Banco</Text>
      <Text style={styles.subtitle}>Usuario: {userName}</Text>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceText}>🪙 {coins.toFixed(1)} Monedas</Text>
        <Text style={styles.balanceText}>⏱️ {hoursDisplay}h {minsDisplay}m</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏦 Banco de Intercambio</Text>
        <View style={styles.conversionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardDesc}>1 Hora ➔ {hoursToCoinsRate} Monedas</Text>
            <Pressable style={styles.actionButton} onPress={handleConvertHoursToCoins}>
              <Text style={styles.actionButtonText}>Vender 1 Hora</Text>
            </Pressable>
          </View>
          <View style={{ width: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardDesc}>{coinsToHoursRate} Monedas ➔ 1 Hora</Text>
            <Pressable style={[styles.actionButton, styles.buyHourButton]} onPress={handleConvertCoinsToHours}>
              <Text style={styles.actionButtonText}>Comprar 1 Hora</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🤝 Transferir Monedas</Text>
        <TextInput
          style={styles.input}
          placeholder="Nombre del destinatario"
          placeholderTextColor="#64748b"
          value={recipientName}
          onChangeText={setRecipientName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Cantidad a enviar"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          value={transferAmount}
          onChangeText={setTransferAmount}
        />

        {/* MENSAJE VISUAL DE ERROR EN LA TRANSFERENCIA */}
        {transferError ? <Text style={styles.errorText}>{transferError}</Text> : null}

        <Pressable 
          style={[styles.actionButton, { backgroundColor: '#d97706', marginTop: 4 }, transferring && styles.disabled]} 
          onPress={handleTransferCoins}
          disabled={transferring}
        >
          {transferring ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.actionButtonText}>Enviar Monedas</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Ítems Disponibles</Text>
      <FlatList
        data={shopItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.title}</Text>
              <Text style={styles.itemDesc}>{item.description}</Text>
              <Text style={styles.itemPrice}>🪙 {item.price} Monedas</Text>
            </View>
            <Pressable style={styles.buyButton} onPress={() => handleBuyItem(item)}>
              <Text style={styles.buyButtonText}>Comprar</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay ítems cargados en la tienda todavía.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  title: { color: '#f8fafc', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 15 },
  balanceCard: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#111827', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#1f2937', marginBottom: 15 },
  balanceText: { color: '#fbbf24', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#111827', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#1f2937', marginBottom: 15 },
  cardTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  cardDesc: { color: '#94a3b8', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  conversionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionButton: { backgroundColor: '#4f46e5', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  buyHourButton: { backgroundColor: '#059669' },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, backgroundColor: '#0f172a', color: '#f8fafc', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10 },
  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  itemCard: { backgroundColor: '#111827', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#1f2937' },
  itemName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  itemDesc: { color: '#94a3b8', fontSize: 12, marginVertical: 4 },
  itemPrice: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  buyButton: { backgroundColor: '#10b981', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  buyButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  disabled: { opacity: 0.6 },
});