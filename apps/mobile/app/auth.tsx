import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function AuthScreen() {
  const { returnTo, placeId, visitId, placeName } = useLocalSearchParams<{ returnTo?: string; placeId?: string; visitId?: string; placeName?: string }>();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError('');
    if (!email || password.length < 8 || (mode === 'register' && displayName.trim().length < 2)) { setError(mode === 'register' ? 'Completa nombre, correo y una contraseña de 8 caracteres.' : 'Escribe un correo y una contraseña de 8 caracteres.'); return; }
    setSaving(true);
    try {
      if (mode === 'register') await signUp({ email, password, displayName });
      else await signIn({ email, password });
      if (returnTo === '/register') router.replace({ pathname: '/register', params: placeId ? { placeId } : undefined });
      else if (returnTo === '/lists') router.replace({ pathname: '/lists', params: placeId ? { placeId } : undefined });
      else if (returnTo === '/comments') router.replace({ pathname: '/comments', params: { visitId, placeName } });
      else if (returnTo?.startsWith('/place/')) router.replace(returnTo as never);
      else if (returnTo?.startsWith('/user/')) router.replace(returnTo as never);
      else router.replace('/(tabs)/profile');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('409') ? 'Ese correo ya está registrado.' : 'No pudimos completar el acceso. Revisa tus datos.');
    } finally { setSaving(false); }
  }

  return <View style={styles.screen}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar acceso" style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.ink} /></Pressable><View style={styles.mark}><Text style={styles.markText}>tacos<Text style={styles.dot}>.</Text></Text></View><Text style={styles.eyebrow}>{mode === 'login' ? 'VUELVE A TU DIARIO' : 'CREA TU IDENTIDAD GASTRONÓMICA'}</Text><Text style={styles.title}>{mode === 'login' ? 'Entra a tu cuenta.' : 'Tu gusto empieza aquí.'}</Text><Text style={styles.subtitle}>Guarda visitas, construye tu Taste ID y sigue a la gente cuyo criterio confías.</Text>{mode === 'register' ? <TextInput accessibilityLabel="Nombre público" placeholder="Cómo te llamas" placeholderTextColor={colors.dim} value={displayName} onChangeText={setDisplayName} style={styles.input} autoCapitalize="words" /> : null}<TextInput accessibilityLabel="Correo electrónico" placeholder="Correo electrónico" placeholderTextColor={colors.dim} value={email} onChangeText={setEmail} style={styles.input} keyboardType="email-address" autoCapitalize="none" /><TextInput accessibilityLabel="Contraseña" placeholder="Contraseña (mínimo 8 caracteres)" placeholderTextColor={colors.dim} value={password} onChangeText={setPassword} style={styles.input} secureTextEntry autoCapitalize="none" />{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={saving ? 'Guardando acceso' : mode === 'login' ? 'Entrar' : 'Crear cuenta'} style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={submit}><Text style={styles.primaryText}>{saving ? 'Guardando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={mode === 'login' ? 'Cambiar a crear cuenta' : 'Cambiar a entrar'} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}><Text style={styles.switch}>{mode === 'login' ? '¿Todavía no tienes cuenta? Crear una' : 'Ya tengo una cuenta · Entrar'}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: 60 },
  close: { alignSelf: 'flex-start', marginBottom: spacing.xl },
  mark: { alignItems: 'center', marginBottom: spacing.xl },
  markText: { color: colors.ink, fontSize: 32, fontWeight: '900', letterSpacing: -1.5 },
  dot: { color: colors.accent },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 31, fontWeight: '900', letterSpacing: -1, marginTop: 9 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: spacing.lg },
  input: { height: 54, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: spacing.md, fontSize: 14, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  primary: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 54, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: spacing.sm },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  switch: { color: colors.muted, textAlign: 'center', fontSize: 12, fontWeight: '800', marginTop: spacing.lg }
});
