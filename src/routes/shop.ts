import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'horasbiblio_user_name';

export default function ShopScreen() {
  const [userName, setUserName] = useState('');
  const [coins, setCoins] = useState(0);
  const [totalHours, setTotalHours] = useState(0);
  const [hoursToCoinsRate, setHoursToCoinsRate] = useState(10);
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    // 1. Obtener monedas del usuario desde user_wallet
    const { data: wallet } = await supabase
      .from('user_wallet')
      .select('coins')
      .eq('user_name', name)
      .maybeSingle();

    if (wallet) setCoins(wallet.coins || 0);

    // 2. Calcular horas del usuario desde sesiones
    const { data: sessionData } = await supabase
      .from('sesiones')
      .select('total_minutes')
      .eq('user_name', name);

    if (sessionData) {
      const totalMins = sessionData.reduce((acc, curr) => acc + (curr.total_minutes || 0), 0);
      setTotalHours(totalMins / 60);
    }

    // 3. Obtener tipo de cambio dinámico del admin
    const { data: config } = await supabase.from('app_config').select('*');
    if (config) {
      const htc = config.find((c: any) => c.key === 'hours_to_coins_rate');
      if (htc) setHoursToCoinsRate(Number(htc.value));
    }

    // 4. Obtener ítems de la tienda
    const { data: items } = await supabase.from('shop_items').select('*');
    if (items) setShopItems(items);
  };

  const handleConvertHours = async () => {
    if (totalHours < 1) {
      Alert.alert('Saldo insuficiente', 'Necesitas al menos 1 hora de estudio acumulada para convertir.');
      return;
    }

    const newCoins = coins + hoursToCoinsRate;
    
    // Actualizar monedas en Supabase
    const { error } = await supabase
      .from('user_wallet')
      .update({ coins: newCoins })
      .eq('user_name', userName);

    if (error) {
      Alert.alert('Error', 'No se pudo realizar el intercambio.');
      return;
    }

    setCoins(newCoins);
    Alert.alert('¡Intercambio exitoso!', `Convertiste 1 hora por ${hoursToCoinsRate} monedas 🪙.`);
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🛒 Tienda & Banco</Text>
      <Text style={styles.subtitle}>Usuario: {userName}</Text>

      {/* Saldo actual */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceText}>🪙 {coins.toFixed(1)} Monedas</Text>
        <Text style={styles.balanceText}>⏱️ {totalHours.toFixed(1)} Horas</Text>
      </View>

      {/* Banco de conversión */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏦 Banco de Intercambio</Text>
        <Text style={styles.cardDesc}>Tasa actual del Admin: 1 Hora = {hoursToCoinsRate} Monedas</Text>
        <Pressable style={styles.actionButton} onPress={handleConvertHours}>
          <Text style={styles.actionButtonText}>Convertir 1 Hora a Monedas</Text>
        </Pressable>
      </View>

      {/* Lista de la tienda */}
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
  card: { backgroundColor: '#111827', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#1f2937', marginBottom: 20 },
  cardTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  cardDesc: { color: '#94a3b8', fontSize: 13, marginBottom: 12 },
  actionButton: { backgroundColor: '#4f46e5', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  itemCard: { backgroundColor: '#111827', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#1f2937' },
  itemName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  itemDesc: { color: '#94a3b8', fontSize: 12, marginVertical: 4 },
  itemPrice: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  buyButton: { backgroundColor: '#10b981', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  buyButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 20 },
});