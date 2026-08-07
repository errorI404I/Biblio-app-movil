import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, TextInput, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';
import { SHOP_ITEMS } from '@/constants/shopCatalog';

const STORAGE_KEY = 'horasbiblio_user_name';

async function sendPushNotification(expoPushToken: string, title: string, body: string) {
  if (!expoPushToken) return;

  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: { someData: 'goes here' },
  };

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
  } catch (e) {
    console.log('Error enviando push notification:', e);
  }
}

export default function ShopScreen() {
  const [userName, setUserName] = useState('');
  const [coins, setCoins] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [hoursToCoinsRate, setHoursToCoinsRate] = useState(10);
  const [coinsToHoursRate, setCoinsToHoursRate] = useState(15);
  const [shopItems, setShopItems] = useState(SHOP_ITEMS);
  const [loading, setLoading] = useState(true);

  // Estado para llevar el registro de qué ítems ya están activos/comprados
  const [activeItemsMap, setActiveItemsMap] = useState<{ [key: string]: boolean }>({});

  // Estados para transferencia y errores visuales
  const [recipientName, setRecipientName] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Estado para controlar qué ítem se está comprando
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  // Estado y animaciones para el cartel emergente (Modal personalizado)
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const modalScale = useRef(new Animated.Value(0)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  const showSuccessModal = (message: string) => {
    setModalMessage(message);
    setModalVisible(true);
    Animated.parallel([
      Animated.spring(modalScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(modalOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const hideSuccessModal = () => {
    Animated.timing(modalOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setModalVisible(false);
      modalScale.setValue(0);
    });
  };

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

    // Cargar inventario del usuario para marcar botones como activos/comprados
    const { data: invData } = await supabase
      .from('user_inventory')
      .select('item_id, expires_at, is_active')
      .eq('user_name', name)
      .eq('is_active', true);

    const activeMap: { [key: string]: boolean } = {};
    if (invData) {
      const nowTime = Date.now();
      invData.forEach((inv) => {
        if (inv.expires_at) {
          // Si tiene expiración, verificar que no haya vencido
          if (new Date(inv.expires_at).getTime() > nowTime) {
            activeMap[inv.item_id] = true;
          }
        } else {
          // Si es permanente (eterno)
          activeMap[inv.item_id] = true;
        }
      });
    }
    setActiveItemsMap(activeMap);
    setShopItems(SHOP_ITEMS);
  };

  const handleConvertHoursToCoins = async () => {
    const minutesNeeded = 60;
    if (totalMinutes < minutesNeeded) {
      showSuccessModal('⚠️ Necesitas al menos 1 hora de estudio acumulada (60 min) para convertir.');
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
      showSuccessModal(`¡Intercambio exitoso!\nConvertiste 1 hora por ${hoursToCoinsRate} monedas 🪙.`);
    } catch (err) {
      console.error(err);
      showSuccessModal('❌ No se pudo procesar el intercambio.');
    }
  };

  const handleConvertCoinsToHours = async () => {
    if (coins < coinsToHoursRate) {
      showSuccessModal(`⚠️ Necesitas ${coinsToHoursRate} monedas para comprar 1 hora.`);
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
      showSuccessModal(`¡Compra exitosa!\nCanjeaste ${coinsToHoursRate} monedas por 1 hora (+60 min).`);
    } catch (err) {
      console.error(err);
      showSuccessModal('❌ No se pudo completar la compra de horas.');
    }
  };

  const handleTransferCoins = async () => {
    const target = recipientName.trim();
    const amount = parseFloat(transferAmount);
    setTransferError('');

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

      const { error: notifErr } = await supabase.from('notifications').insert({
        user_name: target,
        message: `🪙 ¡${userName} te ha enviado ${amount} monedas!`,
      });
      if (notifErr) console.log('Error creando notificación interna:', notifErr);

      if (recipientWallet?.expo_push_token) {
        await sendPushNotification(
          recipientWallet.expo_push_token,
          '¡Nueva transferencia! 🪙',
          `${userName} te ha enviado ${amount} monedas.`
        );
      }

      setCoins(newSenderCoins);
      setRecipientName('');
      setTransferAmount('');
      showSuccessModal(`¡Transferencia exitosa!\nHas enviado ${amount} monedas 🪙 a ${target}.`);
    } catch (err) {
      console.error(err);
      setTransferError('❌ Error de red. Transacción cancelada.');
    } finally {
      setTransferring(false);
    }
  };

  const handleBuyItem = async (item: any) => {
    if (activeItemsMap[item.id]) {
      showSuccessModal('⚠️ Ya tienes este ítem activo o adquirido.');
      return;
    }

    if (coins < item.price) {
      showSuccessModal('⚠️ Monedas insuficientes.');
      return;
    }

    setPurchasingId(item.id);

    try {
      // 1. Descontar monedas
      const newCoins = coins - item.price;
      const { error: walletError } = await supabase
        .from('user_wallet')
        .update({ coins: newCoins })
        .eq('user_name', userName);

      if (walletError) throw walletError;

      // 2. Calcular fecha de expiración si es temporal
      const expiresAt = item.type === 'temporal' 
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() 
        : null;

      // 3. Guardar en inventario
      const { error: invError } = await supabase
        .from('user_inventory')
        .upsert({
          user_name: userName,
          item_id: item.id,
          is_active: true,
          expires_at: expiresAt,
          type: item.type
        }, { onConflict: 'user_name, item_id' });

      if (invError) throw invError;

      setCoins(newCoins);
      setActiveItemsMap(prev => ({ ...prev, [item.id]: true }));
      showSuccessModal(`¡Compra exitosa: ${item.title}! 🎉`);

    } catch (err) {
      console.error(err);
      showSuccessModal('❌ No se pudo procesar la compra.');
    } finally {
      setPurchasingId(null);
    }
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
        renderItem={({ item }) => {
          const isOwnedOrActive = activeItemsMap[item.id];
          return (
            <View style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.title}</Text>
                <Text style={styles.itemDesc}>{item.description}</Text>
                <Text style={styles.itemPrice}>🪙 {item.price} Monedas</Text>
              </View>
              <Pressable 
                style={[
                  styles.buyButton, 
                  isOwnedOrActive && styles.disabledButton,
                  purchasingId === item.id && { backgroundColor: '#065f46' }
                ]} 
                onPress={() => handleBuyItem(item)}
                disabled={purchasingId !== null || isOwnedOrActive}
              >
                {purchasingId === item.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buyButtonText}>
                    {isOwnedOrActive ? 'Adquirido' : 'Comprar'}
                  </Text>
                )}
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay ítems cargados en la tienda todavía.</Text>}
      />

      {/* CARTEL EMERGENTE (MODAL PERSONALIZADO) */}
      {modalVisible && (
        <View style={styles.modalOverlay}>
          <Animated.View 
            style={[
              styles.modalContainer, 
              { transform: [{ scale: modalScale }], opacity: modalOpacity }
            ]}
          >
            <Text style={styles.modalTitle}>✨ Notificación</Text>
            <Text style={styles.modalText}>{modalMessage}</Text>
            
            <Pressable style={styles.modalButton} onPress={hideSuccessModal}>
              <Text style={styles.modalButtonText}>¡Entendido!</Text>
            </Pressable>
          </Animated.View>
        </View>
      )}
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
  buyButton: { backgroundColor: '#10b981', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  buyButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabledButton: { backgroundColor: '#475569', opacity: 0.8 }, // Color gris para el botón inactivo/adquirido
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  disabled: { opacity: 0.6 },

  // Estilos del Cartel Emergente (Modal)
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modalContainer: {
    width: '85%',
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
  modalTitle: {
    color: '#fbbf24',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalText: {
    color: '#f8fafc',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  modalButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#0f172a',
    fontWeight: '900',
    fontSize: 15,
  },
});