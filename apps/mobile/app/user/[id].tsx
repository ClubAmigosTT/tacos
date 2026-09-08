import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { followUser, unfollowUser, userProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(false);
  const { data: profile, isLoading, isError } = useQuery({ queryKey: ['user-profile', id, token], queryFn: () => userProfile(id, token), enabled: Boolean(id) });
  useEffect(() => { if (profile) setFollowing(Boolean(profile.user.following)); }, [profile]);
  const followMutation = useMutation({
    mutationFn: () => following ? unfollowUser(id, token!) : followUser(id, token!),
    onSuccess: () => { setFollowing((value) => !value); void queryClient.invalidateQueries({ queryKey: ['user-profile', id] }); void queryClient.invalidateQueries({ queryKey: ['people'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); }
  });
  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando perfil…</Text></View>;
  if (isError || !profile) return <View style={styles.center}><Text style={styles.title}>Perfil no disponible</Text><Text style={styles.muted}>Puede que esta cuenta ya no esté activa.</Text><Pressable style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>Volver</Text></Pressable></View>;
  const average = profile.stats.averageRating == null ? '—' : profile.stats.averageRating.toFixed(2);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><Text style={styles.eyebrow}>IDENTIDAD GASTRONÓMICA</Text><Ionicons name="person-circle-outline" size={22} color={colors.accent} /></View>
    <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.user.displayName.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.name}>{profile.user.displayName}</Text><Text style={styles.subtitle}>Una mirada al gusto detrás de sus listas.</Text>{user?.id === profile.user.id ? null : token ? <Pressable style={[styles.followButton, following && styles.followingButton]} disabled={followMutation.isPending} onPress={() => followMutation.mutate()}><Ionicons name={following ? 'checkmark' : 'person-add-outline'} size={15} color={following ? colors.muted : colors.background} /><Text style={[styles.followText, following && styles.followingText]}>{following ? 'Siguiendo' : 'Seguir'}</Text></Pressable> : <Pressable style={styles.followButton} onPress={() => router.push({ pathname: '/auth', params: { returnTo: `/user/${profile.user.id}` } })}><Ionicons name="person-add-outline" size={15} color={colors.background} /><Text style={styles.followText}>Entra para seguir</Text></Pressable>}</View>
    <View style={styles.taste}><Text style={styles.tasteEyebrow}>TASTE ID</Text><Text style={styles.tasteTitle}>{profile.taste.title}</Text><Text style={styles.tasteDescription}>{profile.taste.description}</Text><View style={styles.tags}>{profile.taste.tags.map((tag) => <Text style={styles.tag} key={tag}>{tag}</Text>)}</View></View>
    <View style={styles.stats}><Metric label="VISITAS" value={String(profile.stats.visits)} /><Metric label="LISTAS" value={String(profile.stats.listCount)} /><Metric label="PROMEDIO" value={average} /></View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Listas públicas</Text><Text style={styles.count}>{profile.lists.length}</Text></View>
    {profile.lists.length ? profile.lists.map((list) => <Pressable key={list.id} style={styles.list} onPress={() => router.push(`/list/${list.id}`)}><View style={styles.listIcon}><Ionicons name="bookmark-outline" size={18} color={colors.accent} /></View><View style={styles.listCopy}><Text style={styles.listTitle}>{list.title}</Text><Text style={styles.listMeta}>{list.itemCount} lugares · {list.visitedCount} visitados</Text></View><Ionicons name="chevron-forward" size={17} color={colors.dim} /></Pressable>) : <View style={styles.empty}><Ionicons name="albums-outline" size={26} color={colors.dim} /><Text style={styles.emptyTitle}>Aún no hay listas públicas</Text><Text style={styles.muted}>Cuando publique una selección aparecerá aquí.</Text></View>}
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
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  identity: { alignItems: 'center', marginBottom: spacing.xl },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  avatarText: { color: colors.background, fontSize: 31, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 5 },
  followButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9, marginTop: spacing.md },
  followingButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  followingText: { color: colors.muted },
  taste: { backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  tasteEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  tasteTitle: { color: colors.ink, fontSize: 25, fontWeight: '900', marginTop: 13 },
  tasteDescription: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 16 },
  tag: { color: colors.background, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, fontSize: 9, fontWeight: '900' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl },
  metricValue: { color: colors.ink, fontSize: 23, fontWeight: '900' },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  count: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  list: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  listIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  listCopy: { flex: 1 },
  listTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  listMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  backButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  backText: { color: colors.background, fontSize: 12, fontWeight: '900' }
});
