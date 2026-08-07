import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Animated } from 'react-native';
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

  const [activeItemsMap, setActiveItemsMap] = useState<{ [key: string]: boolean }>({});

  const [recipientName, setRecipientName] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Estados para el autocompletado de transferencia de monedas
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Estados específicos para el ítem de Screamer (Castigo)
  const [screamerModalVisible, setScreamerModalVisible] = useState(false);
  const [screamerTarget, setScreamerTarget] = useState('');
  const [screamerSuggestions, setScreamerSuggestions] = useState<string[]>([]);
  const [showScreamerSuggestions, setShowScreamerSuggestions] = useState(false);
  const [screamerLoading, setScreamerLoading] = useState(false);

  const [purchasingId, setPurchasingId] = useState<string | null>(null);

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
          if (new Date(inv.expires_at).getTime() > nowTime) {
            activeMap[inv.item_id] = true;
          }
        } else {
          activeMap[inv.item_id] = true;
        }
      });
    }
    setActiveItemsMap(activeMap);
    setShopItems(SHOP_ITEMS);
  };

  // Autocompletado general para transferencias
  const handleSearchUsers = async (text: string) => {
    setRecipientName(text);
    if (text.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_wallet')
      .select('user_name')
      .ilike('user_name', `%${text}%`)
      .limit(5);

    if (data && !error) {
      const names = data.map(item => item.user_name).filter(n => n.toLowerCase() !== userName.toLowerCase());
      setSuggestions(names);
      setShowSuggestions(names.length > 0);
    }
  };

  // Autocompletado específico para el buscador de la víctima del Screamer
  const handleSearchScreamerTarget = async (text: string) => {
    setScreamerTarget(text);
    if (text.trim().length === 0) {
      setScreamerSuggestions([]);
      setShowScreamerSuggestions(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_wallet')
      .select('user_name')
      .ilike('user_name', `%${text}%`)
      .limit(5);

    if (data && !error) {
      const names = data.map(item => item.user_name).filter(n => n.toLowerCase() !== userName.toLowerCase());
      setScreamerSuggestions(names);
      setShowScreamerSuggestions(names.length > 0);
    }
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
      await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);

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

      const { error: walletErr } = await supabase.from('user_wallet').update({ coins: newCoins }).eq('user_name', userName);
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

      await supabase.from('user_wallet').update({ coins: newSenderCoins }).eq('user_name', userName);
      await supabase.from('user_wallet').update({ coins: newRecipientCoins }).eq('user_name', target);

      await supabase.from('notifications').insert({
        user_name: target,
        message: `🪙 ¡${userName} te ha enviado ${amount} monedas!`,
      });

      if (recipientWallet?.expo_push_token) {
        await sendPushNotification(recipientWallet.expo_push_token, '¡Nueva transferencia! 🪙', `${userName} te ha enviado ${amount} monedas.`);
      }

      setCoins(newSenderCoins);
      setRecipientName('');
      setTransferAmount('');
      setShowSuggestions(false);
      showSuccessModal(`¡Transferencia exitosa!\nHas enviado ${amount} monedas 🪙 a ${target}.`);
    } catch (err) {
      console.error(err);
      setTransferError('❌ Error de red. Transacción cancelada.');
    } finally {
      setTransferring(false);
    }
  };

  const handleBuyScreamer = async () => {
    const target = screamerTarget.trim();
    const screamerPrice = 30;

    if (!target) {
      showSuccessModal('⚠️ Ingresa el nombre de la víctima.');
      return;
    }

    if (target.toLowerCase() === userName.toLowerCase()) {
      showSuccessModal('⚠️ No te puedes asustar a ti mismo.');
      return;
    }

    if (coins < screamerPrice) {
      showSuccessModal(`⚠️ Necesitas ${screamerPrice} monedas para enviar este susto.`);
      return;
    }

    setScreamerLoading(true);
    try {
      const { data: targetUser } = await supabase
        .from('user_wallet')
        .select('user_name')
        .eq('user_name', target)
        .maybeSingle();

      if (!targetUser) {
        showSuccessModal(`❌ El usuario "${target}" no existe.`);
        setScreamerLoading(false);
        return;
      }

      const newCoins = coins - screamerPrice;

      const { error: walletErr } = await supabase
        .from('user_wallet')
        .update({ coins: newCoins })
        .eq('user_name', userName);

      if (walletErr) throw walletErr;

      const { error: punErr } = await supabase
        .from('pending_punishments')
        .insert({
          target_user: target,
          from_user: userName,
          punishment_type: 'screamer',
          amount: screamerPrice,
          triggered: false
        });

      if (punErr) throw punErr;

      setCoins(newCoins);
      setScreamerTarget('');
      setScreamerModalVisible(false);
      setShowScreamerSuggestions(false);
      showSuccessModal(`👻 ¡Susto enviado con éxito a ${target}!\nLe aparecerá en su próximo check-in.`);

    } catch (err) {
      console.error(err);
      showSuccessModal('❌ No se pudo programar el susto.');
    } finally {
      setScreamerLoading(false);
    }
  };

  const handleBuyItem = async (item: any) => {
    if (item.id === 'screamer_susto') {
      setScreamerModalVisible(true);
      return;
    }

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
      const newCoins = coins - item.price;
      const { error: walletError } = await supabase
        .from('user_wallet')
        .update({ coins: newCoins })
        .eq('user_name', userName);

      if (walletError) throw walletError;

      const expiresAt = item.type === 'temporal' 
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() 
        : null;

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
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
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
        
        <View style={{ position: 'relative', zIndex: 999, elevation: 5 }}>
          <TextInput
            style={styles.input}
            placeholder="Nombre del destinatario"
            placeholderTextColor="#64748b"
            value={recipientName}
            onChangeText={handleSearchUsers}
            autoCapitalize="words"
          />

          {showSuggestions && (
            <View style={styles.suggestionsContainer}>
              <ScrollView nestedScrollEnabled={true} style={{ maxHeight: 180 }}>
                {suggestions.map((item, index) => (
                  <Pressable
                    key={index}
                    style={styles.suggestionItem}
                    onPress={() => {
                      setRecipientName(item);
                      setShowSuggestions(false);
                    }}
                  >
                    <Text style={{ color: '#f8fafc', fontSize: 14 }}>👤 {item}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

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

      <View style={styles.itemCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName}>👻 Susto / Screamer</Text>
          <Text style={styles.itemDesc}>Asusta a alguien en su próximo check-in con una sorpresa terrorífica.</Text>
          <Text style={styles.itemPrice}>🪙 30 Monedas</Text>
        </View>
        <Pressable 
          style={[styles.buyButton, { backgroundColor: '#7c3aed' }]} 
          onPress={() => handleBuyItem({ id: 'screamer_susto', title: 'Screamer', price: 30 })}
        >
          <Text style={styles.buyButtonText}>Comprar</Text>
        </Pressable>
      </View>
      
      {shopItems.length === 0 ? (
        <Text style={styles.emptyText}>No hay ítems cargados en la tienda todavía.</Text>
      ) : (
        shopItems.map((item) => {
          const isOwnedOrActive = activeItemsMap[item.id];
          return (
            <View key={item.id} style={styles.itemCard}>
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
        })
      )}

      {/* MODAL PARA SELECCIONAR VÍCTIMA DEL SCREAMER CON AUTOCOMPLETADO CORREGIDO */}
      {screamerModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>👻 ¡Enviar un Susto!</Text>
            <Text style={styles.modalText}>¿A qué usuario quieres enviarle el screamer?</Text>
            
            {/* Contenedor con zIndex masivo y overflow visible para producción */}
            <View style={{ position: 'relative', zIndex: 99999, elevation: 99, width: '100%', marginBottom: 15 }}>
              <TextInput
                style={[styles.input, { width: '100%', marginBottom: 0 }]}
                placeholder="Nombre de la víctima"
                placeholderTextColor="#64748b"
                value={screamerTarget}
                onChangeText={handleSearchScreamerTarget}
                autoCapitalize="words"
              />

              {showScreamerSuggestions && (
                <View style={styles.suggestionsContainer}>
                  <ScrollView nestedScrollEnabled={true} style={{ maxHeight: 150 }}>
                    {screamerSuggestions.map((item, index) => (
                      <Pressable
                        key={index}
                        style={styles.suggestionItem}
                        onPress={() => {
                          setScreamerTarget(item);
                          setShowScreamerSuggestions(false);
                        }}
                      >
                        <Text style={{ color: '#f8fafc', fontSize: 14 }}>👤 {item}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <Pressable 
                style={[styles.modalButton, { backgroundColor: '#475569', flex: 1, marginRight: 8 }]} 
                onPress={() => setScreamerModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>Cancelar</Text>
              </Pressable>

              <Pressable 
                style={[styles.modalButton, { backgroundColor: '#7c3aed', flex: 1, marginLeft: 8 }, screamerLoading && styles.disabled]} 
                onPress={handleBuyScreamer}
                disabled={screamerLoading}
              >
                {screamerLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Enviar Susto</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scrollContent: { padding: 20, paddingBottom: 40 },
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
  
  suggestionsContainer: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 99999, // Aumentado para producción
    elevation: 999, // Elevación alta para Android nativo
    maxHeight: 180,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },

  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10, marginTop: 5 },
  itemCard: { backgroundColor: '#111827', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#1f2937' },
  itemName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  itemDesc: { color: '#94a3b8', fontSize: 12, marginVertical: 4 },
  itemPrice: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  buyButton: { backgroundColor: '#10b981', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  buyButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabledButton: { backgroundColor: '#475569', opacity: 0.8 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  disabled: { opacity: 0.6 },

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
    overflow: 'visible', // Clave para que las sugerencias no se corten
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