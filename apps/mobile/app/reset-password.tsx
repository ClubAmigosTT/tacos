import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { resetPassword } from '@/lib/api';
import { colors, radii, spacing, typography } from '@/theme';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function save() {
    if (password.length < 8 || token.trim().length < 20) { setError('Usa un token válido y una contraseña de al menos 8 caracteres.'); return; }
    try { setError(''); await resetPassword(token.trim(), password); setDone(true); } catch { setError('El enlace no es válido o ya expiró.'); }
  }

  if (done) return <View style={styles.center}><Text style={styles.title}>Contraseña actualizada.</Text><Pressable style={styles.primary} onPress={() => router.replace('/auth')}><Text style={styles.primaryText}>Entrar</Text></Pressable></View>;
  return <View style={styles.center}><Text style={styles.kicker}>CUENTA</Text><Text style={styles.title}>Crea una contraseña nueva.</Text><TextInput value={token} onChangeText={setToken} placeholder="Token de recuperación" placeholderTextColor={colors.textTertiary} style={styles.input} autoCapitalize="none" /><TextInput value={password} onChangeText={setPassword} placeholder="Nueva contraseña (mínimo 8 caracteres)" placeholderTextColor={colors.textTertiary} style={styles.input} secureTextEntry autoCapitalize="none" /><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void save()}><Text style={styles.primaryText}>Actualizar contraseña</Text></Pressable></View>;
}

const styles = StyleSheet.create({ center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, kicker: { color: colors.tortilla, fontSize: 10, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 }, title: { color: colors.textPrimary, fontSize: 28, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 8, textAlign: 'center' }, input: { width: '100%', minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 14, marginTop: spacing.md }, error: { color: colors.danger, minHeight: 20, marginTop: 10 }, primary: { width: '100%', minHeight: 54, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md }, primaryText: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold } });
