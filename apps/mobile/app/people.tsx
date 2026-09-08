import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { followUser, searchUsers } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function PeopleScreen() {
  const { token, user } = useAuth();
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState<string[]>([]);
  const { data, isFetching } = useQuery({ queryKey: ['people', query], queryFn: () => searchUsers(query, token), enabled: query.trim().length >= 2 });
  const mutation = useMutation({ mutationFn: (userId: string) => followUser(userId, token!), onSuccess: (_, userId) => setFollowing((current) => [...current, userId]) });
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>GRAFO SOCIAL</Text><Text style={styles.title}>Encuentra criterio</Text></View><Ionicons name="people-outline" size={22} color={colors.accent} /></View>
    {!user ? <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="person-add-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Entra para seguir personas</Text><Text style={styles.loginDetail}>Tu feed mejora cuando aprende de gente con gustos parecidos.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable> : null}
    <View style={styles.search}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Nombre o correo" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" /></View>
    {isFetching ? <Text style={styles.hint}>Buscando…</Text> : query.trim().length < 2 ? <Text style={styles.hint}>Escribe al menos dos caracteres para buscar.</Text> : data?.users?.length ? data.users.map((person) => <View style={styles.person} key={person.id}><View style={styles.personAvatar}><Text style={styles.personAvatarText}>{person.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{person.displayName}</Text><Text style={styles.personEmail}>{person.email}</Text></View><Pressable style={[styles.follow, following.includes(person.id) && styles.following]} disabled={following.includes(person.id) || mutation.isPending} onPress={() => mutation.mutate(person.id)}><Text style={[styles.followText, following.includes(person.id) && styles.followTextFollowing]}>{following.includes(person.id) ? 'Siguiendo' : 'Seguir'}</Text></Pressable></View>) : <View style={styles.empty}><Ionicons name="search-outline" size={26} color={colors.dim} /><Text style={styles.emptyTitle}>No encontramos a nadie</Text><Text style={styles.emptyText}>Prueba con otro nombre o invita a tus amigos a construir su Taste ID.</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 3 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.lg },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.background, fontSize: 14, fontWeight: '900' },
  loginDetail: { color: colors.background, opacity: 0.7, fontSize: 11, marginTop: 3 },
  search: { height: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 10 },
  input: { flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  hint: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  person: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  personAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  personAvatarText: { color: colors.background, fontSize: 16, fontWeight: '900' },
  personCopy: { flex: 1 },
  personName: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  personEmail: { color: colors.muted, fontSize: 11, marginTop: 3 },
  follow: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  following: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  followText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  followTextFollowing: { color: colors.muted },
  empty: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.md },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 }
});
