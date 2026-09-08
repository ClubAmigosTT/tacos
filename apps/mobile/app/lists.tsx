import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { lists as fixtureLists, type List } from '@/data/fixtures';
import { addListItem, createList, lists as listsRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function ListsScreen() {
  const { token, user } = useAuth();
  const { placeId } = useLocalSearchParams<{ placeId?: string }>();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['lists', token], queryFn: () => listsRequest(token), enabled: true });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useMutation({
    mutationFn: () => createList({ title, description }, token!),
    onSuccess: () => { setTitle(''); setDescription(''); void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  const saveMutation = useMutation({
    mutationFn: (listId: string) => addListItem(listId, { branchId: placeId! }, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  const apiLists = data?.lists ?? [];
  const scopedLists = placeId && user ? apiLists.filter((list) => list.owner.id === user.id) : apiLists;
  const visibleLists: List[] = scopedLists.length ? scopedLists : (!user ? fixtureLists : []);

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CURADURÍA PERSONAL</Text><Text style={styles.title}>Tus listas</Text></View><Ionicons name="albums-outline" size={22} color={colors.accent} /></View>
    <Text style={styles.intro}>{placeId ? 'Elige una lista para guardar esta taquería. Después podrás volver a ella desde tu perfil.' : 'Guarda lugares por antojo, colonia o estado de ánimo. Las listas convierten tus visitas en una forma de recomendar.'}</Text>
    {user ? <View style={styles.createCard}><Text style={styles.createEyebrow}>NUEVA LISTA</Text><TextInput value={title} onChangeText={setTitle} placeholder="Ej. Pastor que sí defendería" placeholderTextColor={colors.dim} style={styles.input} maxLength={80} /><TextInput value={description} onChangeText={setDescription} placeholder="Una descripción breve (opcional)" placeholderTextColor={colors.dim} style={[styles.input, styles.descriptionInput]} maxLength={240} multiline /><Pressable style={[styles.createButton, (!title.trim() || mutation.isPending) && styles.disabled]} disabled={!title.trim() || mutation.isPending} onPress={() => mutation.mutate()}><Ionicons name="add" size={18} color={colors.background} /><Text style={styles.createButtonText}>{mutation.isPending ? 'Guardando…' : 'Crear lista'}</Text></Pressable></View> : <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="person-add-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Crea listas públicas</Text><Text style={styles.loginDetail}>Entra para guardar lugares y compartir tu criterio.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>}
    <View style={styles.listHeader}><Text style={styles.sectionTitle}>{placeId ? 'Elige una lista' : 'Selecciones'}</Text><Text style={styles.count}>{visibleLists.length} LISTAS</Text></View>
    {saveMutation.isError ? <Text style={styles.error}>No pudimos guardar el lugar en esa lista.</Text> : null}
    {visibleLists.length ? visibleLists.map((list) => <ListCard key={list.id} list={list} saveMode={Boolean(placeId)} saved={saveMutation.isSuccess && saveMutation.variables === list.id} onPress={placeId ? () => { if (user) saveMutation.mutate(list.id); else router.push({ pathname: '/auth', params: { returnTo: '/lists', placeId } }); } : undefined} />) : <View style={styles.empty}><Ionicons name="bookmark-outline" size={25} color={colors.dim} /><Text style={styles.emptyTitle}>Todavía no tienes listas</Text><Text style={styles.emptyText}>Crea la primera y empieza a construir tu mapa de antojos.</Text></View>}
  </ScrollView>;
}

function ListCard({ list, saveMode, saved, onPress }: { list: List; saveMode?: boolean; saved?: boolean; onPress?: () => void }) {
  const progress = list.itemCount ? Math.round((list.visitedCount / list.itemCount) * 100) : 0;
  return <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress} disabled={!onPress}><Image source={{ uri: list.coverImage }} style={styles.cover} /><View style={styles.cardShade} /><View style={styles.cardCopy}><Text style={styles.cardTitle}>{list.title}</Text><Text style={styles.cardDescription}>{list.description}</Text><View style={styles.cardMeta}><Text style={styles.owner}>por @{list.owner.displayName.toLowerCase().replace(/\s+/g, '')}</Text><Text style={styles.progress}>{saveMode ? (saved ? 'GUARDADO ✓' : 'TOCA PARA GUARDAR') : `${list.visitedCount}/${list.itemCount} VISITADOS · ${progress}%`}</Text></View></View></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.lg },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 3 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: spacing.xl },
  createCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.xl },
  createEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginBottom: spacing.sm },
  input: { height: 48, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, color: colors.ink, paddingHorizontal: 13, fontSize: 13, marginBottom: spacing.sm },
  descriptionInput: { minHeight: 48, paddingTop: 13, textAlignVertical: 'top' },
  createButton: { height: 46, borderRadius: radii.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 2 },
  createButtonText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.xl },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.background, fontSize: 14, fontWeight: '900' },
  loginDetail: { color: colors.background, opacity: 0.7, fontSize: 11, marginTop: 3 },
  listHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  count: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  card: { height: 190, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  cover: { width: '100%', height: '100%' },
  cardShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,5,4,0.52)' },
  cardCopy: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md },
  cardTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  cardDescription: { color: colors.ink, opacity: 0.78, fontSize: 12, marginTop: 5 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 },
  owner: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  progress: { color: colors.ink, opacity: 0.76, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.md },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 5 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.md }
});
