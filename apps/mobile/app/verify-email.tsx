import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { verifyEmail } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const { completeSession } = useAuth();
  const [token, setToken] = useState(params.token ?? '');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function confirm() {
    try { setError(''); const result = await verifyEmail(token.trim()); await completeSession(result); setDone(true); } catch { setError('El enlace no es válido o ya expiró.'); }
  }

  if (done) return <View style={styles.center}><Text style={styles.title}>Correo confirmado.</Text><Text style={styles.copy}>Ya puedes volver a Tacos y entrar a tu diario.</Text><Pressable style={styles.primary} onPress={() => router.replace('/auth')}><Text style={styles.primaryText}>Entrar</Text></Pressable></View>;
  return <View style={styles.center}><Text style={styles.kicker}>CUENTA</Text><Text style={styles.title}>Confirma tu correo.</Text><Text style={styles.copy}>Usa el enlace recibido por correo o pega aquí su token.</Text><TextInput value={token} onChangeText={setToken} placeholder="Token de verificación" placeholderTextColor={colors.textTertiary} style={styles.input} autoCapitalize="none" /><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void confirm()}><Text style={styles.primaryText}>Confirmar correo</Text></Pressable><Pressable onPress={() => router.back()}><Text style={styles.cancel}>Volver</Text></Pressable></View>;
}

const styles = StyleSheet.create({ center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, kicker: { color: colors.tortilla, fontSize: 10, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 }, title: { color: colors.textPrimary, fontSize: 28, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 8, textAlign: 'center' }, copy: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.bold, lineHeight: 20, textAlign: 'center', marginTop: 10 }, input: { width: '100%', minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 14, marginTop: spacing.lg }, error: { color: colors.danger, minHeight: 20, marginTop: 10 }, primary: { width: '100%', minHeight: 54, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md }, primaryText: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }, cancel: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.semibold, marginTop: spacing.lg } });
