import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { followUser, searchUsers, unfollowUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

export default function PeopleScreen() {
  const { token, user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const [following, setFollowing] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { data, isFetching, isError, refetch } = useQuery({ queryKey: ['people', debouncedQuery, token], queryFn: ({ signal }) => searchUsers(debouncedQuery, token, signal), enabled: Boolean(token && !authLoading && debouncedQuery.length >= 2) });
  useEffect(() => { if (data?.users) setFollowing(data.users.filter((person) => person.following).map((person) => person.id)); }, [data]);
  const followMutation = useMutation({ mutationFn: (userId: string) => followUser(userId, token!), onSuccess: (_, userId) => { setFollowing((current) => current.includes(userId) ? current : [...current, userId]); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['user-profile', userId] }); } });
  const unfollowMutation = useMutation({ mutationFn: (userId: string) => unfollowUser(userId, token!), onSuccess: (_, userId) => { setFollowing((current) => current.filter((id) => id !== userId)); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['user-profile', userId] }); } });
  if (authLoading) return <View style={styles.center}><Text style={styles.hint}>Cargando el directorio…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos buscar personas" detail="El directorio no está disponible ahora. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>GRAFO SOCIAL</Text><Text style={styles.title}>Encuentra criterio</Text></View><Ionicons name="people-outline" size={22} color={colors.tortilla} /></View>
    {!user ? <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="person-add-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Entra para seguir personas</Text><Text style={styles.loginDetail}>Tu feed mejora cuando aprende de gente con gustos parecidos.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textSecondary} /></Pressable> : null}
    <View style={styles.search}><Ionicons name="search" size={18} color={colors.textSecondary} /><TextInput value={query} onChangeText={setQuery} placeholder="Nombre o correo" placeholderTextColor={colors.textSecondary} style={styles.input} autoCapitalize="none" /></View>
    {followMutation.isError || unfollowMutation.isError ? <Text style={styles.error}>No pudimos actualizar el seguimiento. Inténtalo de nuevo.</Text> : null}
    {!user ? <Text style={styles.hint}>Entra para buscar y seguir personas.</Text> : isFetching || query.trim() !== debouncedQuery ? <Text style={styles.hint}>Buscando…</Text> : query.trim().length < 2 ? <Text style={styles.hint}>Escribe al menos dos caracteres para buscar.</Text> : data?.users?.length ? data.users.map((person) => { const isFollowing = following.includes(person.id); const pending = followMutation.isPending || unfollowMutation.isPending; return <View style={styles.person} key={person.id}><Pressable accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${person.displayName}`} style={styles.personIdentity} onPress={() => router.push(`/user/${person.id}`)}><View style={styles.personAvatar}><Text style={styles.personAvatarText}>{person.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{person.displayName}</Text><Text style={styles.personEmail}>{person.email}</Text></View></Pressable><Pressable accessibilityRole="button" accessibilityLabel={isFollowing ? `Dejar de seguir a ${person.displayName}` : `Seguir a ${person.displayName}`} accessibilityState={{ checked: isFollowing, disabled: pending }} style={[styles.follow, isFollowing && styles.following]} disabled={pending} onPress={() => isFollowing ? unfollowMutation.mutate(person.id) : followMutation.mutate(person.id)}><Text style={[styles.followText, isFollowing && styles.followTextFollowing]}>{isFollowing ? 'Siguiendo' : 'Seguir'}</Text></Pressable></View>; }) : <View style={styles.empty}><Ionicons name="search-outline" size={26} color={colors.textTertiary} /><Text style={styles.emptyTitle}>No encontramos a nadie</Text><Text style={styles.emptyText}>Prueba con otro nombre o invita a tus amigos a construir su Taste ID.</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 30, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -1, marginTop: 3 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tortilla, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.lg },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  loginDetail: { color: colors.background, opacity: 0.7, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: 3 },
  search: { height: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  input: { flex: 1, color: colors.textPrimary, fontSize: 14, fontFamily: typography.fontFamily.regular, paddingVertical: 0 },
  hint: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: spacing.md },
  error: { color: colors.danger, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 17, marginTop: spacing.md },
  person: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  personIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 },
  personAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  personAvatarText: { color: colors.background, fontSize: 16, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  personCopy: { flex: 1 },
  personName: { color: colors.textPrimary, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  personEmail: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: 3 },
  follow: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  following: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  followText: { color: colors.background, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  followTextFollowing: { color: colors.textSecondary },
  empty: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.md },
  emptyText: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 18, textAlign: 'center', marginTop: 5 }
});
