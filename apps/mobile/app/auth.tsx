import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { ApiError, forgotPassword, resendVerification, verifyEmail } from '@/lib/api';
import { colors, spacing, typography } from '@/theme';
import { BrandMark, TacoButton, TacoInput } from '@/components/DesignSystem';

export default function AuthScreen() {
  const { returnTo, placeId, visitId, placeName, branchId, kind } = useLocalSearchParams<{ returnTo?: string; placeId?: string; visitId?: string; placeName?: string; branchId?: string; kind?: string }>();
  const { completeSession, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'verify'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');

  async function submit() {
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || (mode !== 'forgot' && mode !== 'verify' && password.length < 8) || (mode === 'register' && displayName.trim().length < 2) || (mode === 'verify' && verificationToken.trim().length < 20)) { setError(mode === 'register' ? 'Completa nombre, correo y una contraseña de 8 caracteres.' : mode === 'verify' ? 'Pega el token de verificación recibido por correo.' : mode === 'forgot' ? 'Escribe tu correo.' : 'Escribe un correo y una contraseña de 8 caracteres.'); return; }
    setSaving(true);
    try {
      if (mode === 'register') {
        const result = await signUp({ email: normalizedEmail, password, displayName: displayName.trim() });
        if (result.verificationRequired) { setVerificationToken(result.verificationToken ?? ''); setMode('verify'); return; }
      } else if (mode === 'forgot') {
        await forgotPassword(normalizedEmail);
        setError('Si el correo existe, recibirás un enlace para restablecer la contraseña.');
        return;
      } else if (mode === 'verify') {
        const result = await verifyEmail(verificationToken.trim());
        // Verification returns a session so the user can continue directly.
        await completeSession(result);
      } else await signIn({ email: normalizedEmail, password });
      if (returnTo === '/register') router.replace({ pathname: '/register', params: placeId ? { placeId } : undefined });
      else if (returnTo === '/catalog-proposal') router.replace({ pathname: '/catalog-proposal', params: { ...(branchId ? { branchId } : {}), ...(kind ? { kind } : {}) } });
      else if (returnTo === '/lists') router.replace({ pathname: '/lists', params: placeId ? { placeId } : undefined });
      else if (returnTo === '/comments') router.replace({ pathname: '/comments', params: { visitId, placeName } });
      else if (returnTo?.startsWith('/place/')) router.replace(returnTo as never);
      else if (returnTo?.startsWith('/user/')) router.replace(returnTo as never);
      else router.replace('/(tabs)/profile');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setError('Ese correo ya está registrado. Entra con tu contraseña.');
      else if (cause instanceof ApiError && cause.status === 503) setError('La cuenta no pudo activarse temporalmente. Inténtalo de nuevo en unos minutos.');
      else if (cause instanceof ApiError && cause.status === 400) setError('Revisa los datos: el correo o la contraseña no tienen un formato válido.');
      else setError('No pudimos completar el acceso. Revisa tus datos.');
    } finally { setSaving(false); }
  }

  async function resend() {
    try { const result = await resendVerification(email); if (result.verificationToken) setVerificationToken(result.verificationToken); setError('Si la cuenta existe, enviamos un correo nuevo.'); } catch { setError('No pudimos reenviar el correo. Inténtalo en unos minutos.'); }
  }

  const isRecovery = mode === 'forgot';
  const isVerification = mode === 'verify';
  const title = isRecovery ? 'Recupera tu cuenta.' : isVerification ? 'Confirma tu correo.' : mode === 'login' ? 'Entra a tu cuenta.' : 'Tu gusto empieza aquí.';
  const submitLabel = saving ? 'Guardando…' : isRecovery ? 'Enviar enlace' : isVerification ? 'Confirmar correo' : mode === 'login' ? 'Entrar' : 'Crear cuenta';
  return <View style={styles.screen}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar acceso" style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.textPrimary} /></Pressable><View style={styles.mark}><BrandMark /></View><Text style={styles.eyebrow}>{isRecovery ? 'RECUPERA TU DIARIO' : isVerification ? 'UN ÚLTIMO PASO' : mode === 'login' ? 'VUELVE A TU DIARIO' : 'CREA TU IDENTIDAD GASTRONÓMICA'}</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{isRecovery ? 'Te enviaremos un enlace de un solo uso. No revelamos si un correo está registrado.' : isVerification ? 'Pega el código del correo de confirmación para activar tu cuenta.' : 'Guarda visitas, construye tu Taste ID y sigue a la gente cuyo criterio confías.'}</Text>{mode === 'register' ? <TacoInput accessibilityLabel="Nombre público" placeholder="Cómo te llamas" value={displayName} onChangeText={setDisplayName} style={styles.inputSpacing} autoCapitalize="words" /> : null}<TacoInput accessibilityLabel="Correo electrónico" placeholder="Correo electrónico" value={email} onChangeText={setEmail} style={styles.inputSpacing} keyboardType="email-address" autoCapitalize="none" />{!isRecovery && !isVerification ? <TacoInput accessibilityLabel="Contraseña" placeholder="Contraseña (mínimo 8 caracteres)" value={password} onChangeText={setPassword} style={styles.inputSpacing} secureTextEntry autoCapitalize="none" /> : null}{isVerification ? <TacoInput accessibilityLabel="Código de verificación" placeholder="Token de verificación" value={verificationToken} onChangeText={setVerificationToken} style={styles.inputSpacing} autoCapitalize="none" /> : null}{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}<TacoButton accessibilityLabel={saving ? 'Guardando acceso' : isRecovery ? 'Enviar enlace de recuperación' : isVerification ? 'Confirmar correo' : mode === 'login' ? 'Entrar' : 'Crear cuenta'} label={submitLabel} style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={submit} icon={<Ionicons name="arrow-forward" size={18} color={colors.meatDark} />} />{isVerification ? <Pressable accessibilityRole="button" accessibilityLabel="Reenviar correo de verificación" onPress={() => void resend()}><Text style={styles.switch}>Reenviar correo de confirmación</Text></Pressable> : null}{mode === 'login' ? <Pressable accessibilityRole="button" accessibilityLabel="Recuperar contraseña" onPress={() => { setMode('forgot'); setError(''); }}><Text style={styles.switch}>¿Olvidaste tu contraseña?</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="Cambiar modo de acceso" onPress={() => { setMode(mode === 'login' || mode === 'forgot' || mode === 'verify' ? 'register' : 'login'); setError(''); }}><Text style={styles.switch}>{mode === 'login' ? '¿Todavía no tienes cuenta? Crear una' : 'Ya tengo una cuenta · Entrar'}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: 60 },
  close: { alignSelf: 'flex-start', marginBottom: spacing.xl },
  mark: { alignItems: 'center', marginBottom: spacing.xl },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 31, fontWeight: typography.weight.bold, letterSpacing: -1, marginTop: 9 },
  subtitle: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: spacing.lg },
  inputSpacing: { marginBottom: spacing.sm },
  error: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, marginBottom: spacing.sm },
  primary: { marginTop: spacing.sm },
  disabled: { opacity: 0.5 },
  switch: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, textAlign: 'center', fontSize: 12, fontWeight: typography.weight.medium, marginTop: spacing.lg }
});
