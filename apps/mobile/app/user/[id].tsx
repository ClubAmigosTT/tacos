import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, followUser, unfollowUser, userProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { TasteSignature } from '@/components/TasteSignature';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(false);
  const { data: profile, isLoading, isError, error, refetch } = useQuery({ queryKey: ['user-profile', id, token], queryFn: () => userProfile(id, token), enabled: Boolean(id && !authLoading) });
  useEffect(() => { if (profile) setFollowing(Boolean(profile.user.following)); }, [profile]);
  const followMutation = useMutation({
    mutationFn: () => following ? unfollowUser(id, token!) : followUser(id, token!),
    onSuccess: () => { setFollowing((value) => !value); void queryClient.invalidateQueries({ queryKey: ['user-profile', id] }); void queryClient.invalidateQueries({ queryKey: ['people'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); }
  });
  if (authLoading || isLoading) return <View style={styles.center}><Text style={styles.muted}>{authLoading ? 'Preparando perfil…' : 'Cargando perfil…'}</Text></View>;
  if (isError && !(error instanceof ApiError && error.status === 404)) return <AsyncErrorState title="No pudimos cargar el perfil" detail="La cuenta no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  if (!profile) return <View style={styles.center}><Text style={styles.title}>Perfil no disponible</Text><Text style={styles.muted}>Puede que esta cuenta ya no esté activa.</Text><Pressable style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>Volver</Text></Pressable></View>;
  const average = profile.stats.averageRating == null ? '—' : profile.stats.averageRating.toFixed(2);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><Text style={styles.eyebrow}>IDENTIDAD GASTRONÓMICA</Text><Ionicons name="person-circle-outline" size={22} color={colors.tortilla} /></View>
    <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.user.displayName.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.name}>{profile.user.displayName}</Text><Text style={styles.subtitle}>Una mirada al gusto detrás de sus listas.</Text>{user?.id === profile.user.id ? null : token ? <Pressable accessibilityRole="button" accessibilityLabel={following ? `Dejar de seguir a ${profile.user.displayName}` : `Seguir a ${profile.user.displayName}`} style={[styles.followButton, following && styles.followingButton]} disabled={followMutation.isPending} onPress={() => followMutation.mutate()}><Ionicons name={following ? 'checkmark' : 'person-add-outline'} size={15} color={following ? colors.textSecondary : colors.background} /><Text style={[styles.followText, following && styles.followingText]}>{followMutation.isPending ? 'Actualizando…' : following ? 'Siguiendo' : 'Seguir'}</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={`Entrar para seguir a ${profile.user.displayName}`} style={styles.followButton} onPress={() => router.push({ pathname: '/auth', params: { returnTo: `/user/${profile.user.id}` } })}><Ionicons name="person-add-outline" size={15} color={colors.background} /><Text style={styles.followText}>Entra para seguir</Text></Pressable>}{followMutation.isError ? <Text accessibilityLiveRegion="polite" style={styles.followError}>No pudimos actualizar el seguimiento. Inténtalo de nuevo.</Text> : null}</View>
    <View style={styles.taste}><Text style={styles.tasteEyebrow}>TASTE ID</Text><Text style={styles.tasteTitle}>{profile.taste.title}</Text><Text style={styles.tasteDescription}>{profile.taste.description}</Text><View style={styles.tags}>{profile.taste.tags.map((tag) => <Text style={styles.tag} key={tag}>{tag}</Text>)}</View><TasteSignature profile={profile.taste.hasData ? profile.taste.profile : undefined} /></View>
    <View style={styles.stats}><Metric label="VISITAS" value={String(profile.stats.visits)} /><Metric label="LISTAS" value={String(profile.stats.listCount)} /><Metric label="PROMEDIO" value={average} /></View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Listas públicas</Text><Text style={styles.count}>{profile.lists.length}</Text></View>
    {profile.lists.length ? profile.lists.map((list) => <Pressable key={list.id} accessibilityRole="button" accessibilityLabel={`Abrir lista ${list.title}`} style={styles.list} onPress={() => router.push(`/list/${list.id}`)}><View style={styles.listIcon}><Ionicons name="bookmark-outline" size={18} color={colors.tortilla} /></View><View style={styles.listCopy}><Text style={styles.listTitle}>{list.title}</Text><Text style={styles.listMeta}>{list.itemCount} lugares · {list.visitedCount} visitados</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textTertiary} /></Pressable>) : <View style={styles.empty}><Ionicons name="albums-outline" size={26} color={colors.textTertiary} /><Text style={styles.emptyTitle}>Aún no hay listas públicas</Text><Text style={styles.muted}>Cuando publique una selección aparecerá aquí.</Text></View>}
  </ScrollView>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.4 },
  identity: { alignItems: 'center', marginBottom: spacing.xl },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  avatarText: { color: colors.background, fontSize: 31, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  name: { color: colors.textPrimary, fontSize: 29, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -0.8 },
  subtitle: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: 5 },
  followButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9, marginTop: spacing.md },
  followingButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followText: { color: colors.background, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  followingText: { color: colors.textSecondary },
  followError: { color: colors.danger, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 16, textAlign: 'center', marginTop: 8, maxWidth: 260 },
  taste: { backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  tasteEyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.4 },
  tasteTitle: { color: colors.textPrimary, fontSize: 25, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 13 },
  tasteDescription: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, marginTop: 5 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 16 },
  tag: { color: colors.background, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl },
  metricValue: { color: colors.textPrimary, fontSize: 23, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  metricLabel: { color: colors.textSecondary, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontSize: 22, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  count: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  list: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  listIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  listCopy: { flex: 1 },
  listTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  listMeta: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: 4 },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.md },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  title: { color: colors.textPrimary, fontSize: 25, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  backButton: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  backText: { color: colors.background, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }
});
