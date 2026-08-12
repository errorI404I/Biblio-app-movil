import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { supabase } from '@/integrations/supabase/client';

const CURRENT_APP_VERSION = '2.0.0';

export default function VersionChecker({ children }: { children: React.ReactNode }) {
  const [updateRequired, setUpdateRequired] = useState(true);
  const [updateUrl, setUpdateUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [debugLog, setDebugLog] = useState('Iniciando verificación...');

  useEffect(() => {
    checkVersion();
  }, []);

  const checkVersion = async () => {
    try {
      setDebugLog('1. Consultando Supabase (app_config)...');
      const { data, error } = await supabase
        .from('app_config')
        .select('*')
        .in('key', ['min_app_version', 'update_url']);

      if (error) {
        setDebugLog(`Error en Supabase: ${error.message}`);
        setUpdateRequired(true);
        setLoading(false);
        return;
      }

      if (!data || data.length === 0) {
        setDebugLog('2. No se encontraron registros. Bloqueando.');
        setUpdateRequired(true);
        setLoading(false);
        return;
      }

      setDebugLog(`3. Datos obtenidos: ${JSON.stringify(data)}`);
      
      // Buscamos usando 'min_app_version' y leyendo la columna 'valor'
      const minVersionRow = data.find((c: any) => c.key === 'min_app_version');
      const urlRow = data.find((c: any) => c.key === 'update_url');

      const minVersion = minVersionRow ? (minVersionRow.valor || minVersionRow.value) : '99.99.99';
      setUpdateUrl(urlRow ? (urlRow.valor || urlRow.value) : '');

      setDebugLog(`4. Versión actual: ${CURRENT_APP_VERSION} vs Mínima BD: ${minVersion}`);

      if (isVersionOutdated(CURRENT_APP_VERSION, minVersion)) {
        setDebugLog('5. Resultado: App desactualizada. BLOQUEANDO.');
        setUpdateRequired(true);
      } else {
        setDebugLog('5. Resultado: Versión correcta. DEJANDO PASAR.');
        setUpdateRequired(false);
      }
    } catch (err: any) {
      setDebugLog(`Excepción crítica: ${err?.message || err}`);
      setUpdateRequired(true);
    } finally {
      setLoading(false);
    }
  };

  const isVersionOutdated = (current: string, minimum: string) => {
    // Si en la base de datos pusiste un número entero como "100" y la app es "2.0.0", 
    // forzamos el bloqueo comparando directamente si son distintos o menores.
    if (!minimum.includes('.')) {
      return true; // Bloquea si la versión mínima es un número estricto mayor
    }

    const currParts = current.split('.').map(Number);
    const minParts = minimum.split('.').map(Number);

    for (let i = 0; i < Math.max(currParts.length, minParts.length); i++) {
      const curr = currParts[i] || 0;
      const min = minParts[i] || 0;
      if (curr < min) return true;
      if (curr > min) return false;
    }
    return false;
  };

  const handleUpdatePress = () => {
    if (updateUrl) {
      Linking.openURL(updateUrl);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text style={{ color: '#38bdf8', marginTop: 15, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 }}>
          {debugLog}
        </Text>
      </View>
    );
  }

  if (updateRequired) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🚀</Text>
          <Text style={styles.title}>¡Actualización Obligatoria!</Text>
          <Text style={styles.text}>
            Tu versión (v{CURRENT_APP_VERSION}) requiere actualización obligatoria.
          </Text>
          <Text style={[styles.subText, { color: '#ef4444', marginBottom: 15 }]}>
            [DEBUG LOG]: {debugLog}
          </Text>

          {updateUrl ? (
            <Pressable style={styles.button} onPress={handleUpdatePress}>
              <Text style={styles.buttonText}>Actualizar Ahora</Text>
            </Pressable>
          ) : (
            <Text style={styles.subText}>No se configuró URL de actualización en la BD.</Text>
          )}
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { backgroundColor: '#111827', borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#1f2937', width: '100%', maxWidth: 400 },
  emoji: { fontSize: 40, marginBottom: 12 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  text: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 10 },
  subText: { color: '#64748b', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  button: { backgroundColor: '#f59e0b', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, width: '100%', alignItems: 'center' },
  buttonText: { color: '#0f172a', fontWeight: '900', fontSize: 15 },
});