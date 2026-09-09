import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { deleteAccount, exportAccount, revokeAllSessions } from '@/lib/api';
import { colors, radii, spacing } from '@/theme';

export default function SettingsScreen() {
  const { user, token, loading: authLoading, signOut, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (user) setDisplayName(user.displayName); }, [user]);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu cuenta…</Text></View>;
  if (!user) return <View style={styles.center}><Ionicons name="person-circle-outline" size={42} color={colors.accent} /><Text style={styles.title}>Entra para editar tu perfil</Text><Pressable style={styles.primary} onPress={() => router.push('/auth')}><Text style={styles.primaryText}>Entrar</Text></Pressable></View>;

  async function save() {
    const nextName = displayName.trim();
    if (nextName.length < 2) { setError('Usa al menos dos caracteres.'); return; }
    setSaving(true);
    setError('');
    try { await updateProfile({ displayName: nextName }); router.back(); } catch { setError('No pudimos guardar tu nombre. Inténtalo de nuevo.'); } finally { setSaving(false); }
  }

  async function exportData() {
    if (!token) return;
    try { const data = await exportAccount(token); await Share.share({ message: JSON.stringify(data, null, 2), title: 'Exportación de Tacos' }); } catch { setError('No pudimos exportar tus datos.'); }
  }

  function confirmDelete() {
    Alert.alert('Eliminar cuenta', 'Esta acción elimina tu cuenta, listas, guardados y sesiones. Tus visitas públicas se desvincularán de tu perfil.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => void (async () => { try { await deleteAccount(token!); await signOut(); } catch { setError('No pudimos eliminar tu cuenta.'); } })() }
    ]);
  }

  async function revokeSessions() {
    if (!token) return;
    try { await revokeAllSessions(token); Alert.alert('Sesiones revocadas', 'Las demás sesiones fueron cerradas.'); } catch { setError('No pudimos revocar las sesiones.'); }
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>TU CUENTA</Text><Text style={styles.headerTitle}>Ajustes</Text></View><Ionicons name="settings-outline" size={21} color={colors.accent} /></View><View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.identityCopy}><Text style={styles.identityName}>{user.displayName}</Text><Text style={styles.identityEmail}>{user.email}</Text></View></View><Text style={styles.sectionLabel}>IDENTIDAD</Text><Text style={styles.label}>NOMBRE PÚBLICO</Text><TextInput value={displayName} onChangeText={setDisplayName} placeholder="Tu nombre" placeholderTextColor={colors.dim} style={styles.input} maxLength={40} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void save()} /><Text style={styles.help}>Es el nombre que verán tus amigos y las personas que sigan tus listas.</Text>{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={() => void save()}><Text style={styles.primaryText}>{saving ? 'Guardando…' : 'Guardar cambios'}</Text><Ionicons name="checkmark" size={18} color={colors.background} /></Pressable><Text style={styles.sectionLabel}>PRIVACIDAD</Text><Pressable style={styles.link} onPress={() => router.push('/privacy')}><View style={styles.linkIcon}><Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} /></View><View style={styles.linkCopy}><Text style={styles.linkTitle}>Actividad social</Text><Text style={styles.linkDetail}>Decide si tus visitas aparecen en el feed.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.dim} /></Pressable><Text style={styles.sectionLabel}>TUS DATOS</Text><Pressable style={styles.link} onPress={() => void exportData()}><View style={styles.linkIcon}><Ionicons name="download-outline" size={18} color={colors.accent} /></View><View style={styles.linkCopy}><Text style={styles.linkTitle}>Exportar mis datos</Text><Text style={styles.linkDetail}>Comparte una copia JSON de tu cuenta y diario.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.dim} /></Pressable><Pressable style={styles.link} onPress={() => void revokeSessions()}><View style={styles.linkIcon}><Ionicons name="log-out-outline" size={18} color={colors.accent} /></View><View style={styles.linkCopy}><Text style={styles.linkTitle}>Revocar otras sesiones</Text><Text style={styles.linkDetail}>Cierra las sesiones abiertas en otros dispositivos.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.dim} /></Pressable><Pressable style={styles.dangerLink} onPress={confirmDelete}><Ionicons name="trash-outline" size={18} color={colors.danger} /><Text style={styles.dangerText}>Eliminar cuenta</Text></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: 3 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.xl },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontSize: 23, fontWeight: '900' },
  identityCopy: { flex: 1 },
  identityName: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  identityEmail: { color: colors.muted, fontSize: 11, marginTop: 4 },
  sectionLabel: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginTop: spacing.lg, marginBottom: spacing.md },
  label: { color: colors.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 14, fontSize: 15 },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  primary: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: spacing.xl },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  linkIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  linkCopy: { flex: 1 },
  linkTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  linkDetail: { color: colors.muted, fontSize: 11, marginTop: 3 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13 },
  dangerLink: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: spacing.lg },
  dangerText: { color: colors.danger, fontSize: 13, fontWeight: '900' },
});
