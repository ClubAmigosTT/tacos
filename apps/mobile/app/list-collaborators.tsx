import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addListCollaborator, listDetails, removeListCollaborator, searchUsers, trackEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function ListCollaboratorsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const { data: list, isLoading, isError } = useQuery({ queryKey: ['list', id, token], queryFn: () => listDetails(id, token), enabled: Boolean(id && token) });
  const { data: searchData } = useQuery({ queryKey: ['list-collaborator-search', query, token], queryFn: () => searchUsers(query, token), enabled: Boolean(token && query.trim().length >= 2) });
  const addMutation = useMutation({ mutationFn: (userId: string) => addListCollaborator(id, { userId, role }, token!), onSuccess: () => { void trackEvent('list_collaborator_changed', { list_id: id, role }, token); setQuery(''); void queryClient.invalidateQueries({ queryKey: ['list', id] }); } });
  const roleMutation = useMutation({ mutationFn: (input: { userId: string; role: 'editor' | 'viewer' }) => addListCollaborator(id, input, token!), onSuccess: (_result, input) => { void trackEvent('list_collaborator_changed', { list_id: id, role: input.role }, token); void queryClient.invalidateQueries({ queryKey: ['list', id] }); } });
  const removeMutation = useMutation({ mutationFn: (userId: string) => removeListCollaborator(id, userId, token!), onSuccess: () => { void trackEvent('list_collaborator_changed', { list_id: id, role: 'removed' }, token); void queryClient.invalidateQueries({ queryKey: ['list', id] }); } });
  const existingIds = useMemo(() => new Set((list?.collaborators ?? []).map((collaborator) => collaborator.id)), [list?.collaborators]);
  const results = (searchData?.users ?? []).filter((candidate) => !existingIds.has(candidate.id) && candidate.id !== list?.owner.id);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando colaboradores…</Text></View>;
  if (!token) return <View style={styles.center}><Text style={styles.title}>Entra para gestionar colaboradores</Text><Pressable style={styles.primary} onPress={() => router.push('/auth')}><Text style={styles.primaryText}>Entrar</Text></Pressable></View>;
  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando colaboradores…</Text></View>;
  if (isError || !list || list.owner.id !== user?.id) return <View style={styles.center}><Text style={styles.title}>No puedes gestionar esta lista</Text><Text style={styles.muted}>Sólo el propietario puede invitar o quitar colaboradores.</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Volver</Text></Pressable></View>;
  const collaborators = list.collaborators ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>LISTA COMPARTIDA</Text><Text style={styles.headerTitle}>Colaboradores</Text></View><Ionicons name="people-outline" size={21} color={colors.accent} /></View><Text style={styles.intro}>Invita personas para construir la selección contigo. Los editores pueden agregar o quitar lugares; los lectores sólo pueden verla.</Text><View style={styles.roleRow}><Text style={styles.roleLabel}>NUEVO ROL</Text><View style={styles.roleOptions}><Pressable style={[styles.roleOption, role === 'editor' && styles.roleActive]} onPress={() => setRole('editor')}><Ionicons name="create-outline" size={14} color={role === 'editor' ? colors.background : colors.muted} /><Text style={[styles.roleText, role === 'editor' && styles.roleTextActive]}>Editor</Text></Pressable><Pressable style={[styles.roleOption, role === 'viewer' && styles.roleActive]} onPress={() => setRole('viewer')}><Ionicons name="eye-outline" size={14} color={role === 'viewer' ? colors.background : colors.muted} /><Text style={[styles.roleText, role === 'viewer' && styles.roleTextActive]}>Lector</Text></Pressable></View></View><View style={styles.search}><Ionicons name="search" size={17} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar por nombre o correo" placeholderTextColor={colors.dim} style={styles.input} autoCapitalize="none" /></View>{addMutation.isError || roleMutation.isError ? <Text style={styles.error}>No pudimos actualizar el acceso.</Text> : null}{query.trim().length >= 2 && results.length ? <View style={styles.results}>{results.map((candidate) => <Pressable key={candidate.id} style={styles.result} disabled={addMutation.isPending} onPress={() => addMutation.mutate(candidate.id)}><View style={styles.avatar}><Text style={styles.avatarText}>{candidate.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{candidate.displayName}</Text><Text style={styles.email}>{candidate.email}</Text></View><Ionicons name="add-circle-outline" size={21} color={colors.accent} /></Pressable>)}</View> : query.trim().length >= 2 ? <Text style={styles.muted}>No encontramos personas nuevas con ese nombre.</Text> : null}<View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Personas con acceso</Text><Text style={styles.count}>{collaborators.length}</Text></View>{collaborators.length ? collaborators.map((collaborator) => <View style={styles.member} key={collaborator.id}><View style={styles.avatar}><Text style={styles.avatarText}>{collaborator.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{collaborator.displayName}</Text><Pressable disabled={roleMutation.isPending} onPress={() => roleMutation.mutate({ userId: collaborator.id, role: collaborator.role === 'editor' ? 'viewer' : 'editor' })}><Text style={styles.roleValue}>{collaborator.role === 'editor' ? 'Editor · cambiar a lector' : 'Lector · cambiar a editor'}</Text></Pressable></View><Pressable style={styles.remove} disabled={removeMutation.isPending} onPress={() => removeMutation.mutate(collaborator.id)}><Ionicons name="person-remove-outline" size={17} color={colors.warm} /></Pressable></View>) : <View style={styles.empty}><Ionicons name="people-outline" size={27} color={colors.dim} /><Text style={styles.emptyTitle}>Aún no hay colaboradores</Text><Text style={styles.muted}>Invita a alguien para empezar una lista en equipo.</Text></View>}</ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 3 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  roleRow: { marginBottom: spacing.md },
  roleLabel: { color: colors.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 7 },
  roleOptions: { flexDirection: 'row', gap: 8 },
  roleOption: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface },
  roleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  roleText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  roleTextActive: { color: colors.background },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 49 },
  input: { flex: 1, color: colors.ink, fontSize: 13 },
  results: { marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontWeight: '900' },
  copy: { flex: 1 },
  name: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  email: { color: colors.muted, fontSize: 10, marginTop: 3 },
  roleValue: { color: colors.accent, fontSize: 10, fontWeight: '800', marginTop: 3 },
  remove: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  count: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl, marginTop: spacing.sm },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.sm },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  primary: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 52, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  secondaryText: { color: colors.accent, fontSize: 12, fontWeight: '900' }
});
