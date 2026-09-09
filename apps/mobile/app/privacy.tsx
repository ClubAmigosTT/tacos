import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { privacy as privacyRequest, updatePrivacy } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { colors, radii, spacing } from '@/theme';

export default function PrivacyScreen() {
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['privacy', token], queryFn: () => privacyRequest(token!), enabled: Boolean(token) });
  const [shareActivity, setShareActivity] = useState(true);
  const mutation = useMutation({
    mutationFn: (value: boolean) => updatePrivacy({ shareActivity: value }, token!),
    onSuccess: (result) => { setShareActivity(result.privacy.shareActivity); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); },
    onError: (_error, value) => setShareActivity(!value)
  });

  useEffect(() => { if (data?.privacy) setShareActivity(data.privacy.shareActivity); }, [data]);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu privacidad…</Text></View>;
  if (!token) return <View style={styles.center}><View style={styles.icon}><Ionicons name="lock-closed-outline" size={24} color={colors.background} /></View><Text style={styles.title}>Tu privacidad necesita una cuenta</Text><Text style={styles.muted}>Entra para administrar qué compartes con tu red.</Text><Pressable style={styles.primary} onPress={() => router.push('/auth')}><Text style={styles.primaryText}>Entrar o crear cuenta</Text></Pressable></View>;
  if (isError) return <AsyncErrorState title="No pudimos cargar tu privacidad" detail="Tus preferencias no se modificaron. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>CONTROL DE DATOS</Text><Text style={styles.headerTitle}>Privacidad</Text></View><Ionicons name="shield-checkmark-outline" size={21} color={colors.accent} /></View><Text style={styles.intro}>Decide qué señales de tu diario pueden alimentar la conversación de tu comunidad.</Text>{isLoading ? <Text style={styles.muted}>Cargando preferencias…</Text> : isError ? <Text style={styles.error}>No pudimos cargar tus preferencias.</Text> : <View style={styles.card}><View style={styles.row}><View style={styles.rowIcon}><Ionicons name="people-outline" size={18} color={colors.accent} /></View><View style={styles.copy}><Text style={styles.rowTitle}>Compartir actividad</Text><Text style={styles.rowDetail}>{shareActivity ? 'Tus visitas visibles aparecen en el feed de quienes te siguen.' : 'Tus visitas no aparecen en el feed de tus seguidores.'}</Text></View><Switch value={shareActivity} onValueChange={(value) => { setShareActivity(value); mutation.mutate(value); }} disabled={mutation.isPending} trackColor={{ false: colors.surfaceRaised, true: colors.accent }} thumbColor={colors.ink} /></View>{mutation.isError ? <Text style={styles.error}>No pudimos guardar el cambio. Inténtalo de nuevo.</Text> : null}</View>}<View style={styles.note}><Ionicons name="information-circle-outline" size={17} color={colors.muted} /><Text style={styles.noteText}>Esto no borra tu diario: tus registros siempre siguen visibles para ti y pueden seguir aportando a tus estadísticas privadas.</Text></View></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  icon: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 3 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  rowDetail: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  note: { flexDirection: 'row', gap: 8, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  noteText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  primary: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 52, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' }
});
