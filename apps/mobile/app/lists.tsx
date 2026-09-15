import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { lists as fixtureLists, type List } from '@/data/fixtures';
import { addListItem, createList, isDemoMode, lists as listsRequest, trackEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { CatalogImage } from '@/components/CatalogImage';

export default function ListsScreen() {
  const { token, user, loading: authLoading } = useAuth();
  const { placeId } = useLocalSearchParams<{ placeId?: string }>();
  const queryClient = useQueryClient();
  const { data, isError, refetch } = useQuery({ queryKey: ['lists', token], queryFn: () => listsRequest(token), enabled: !authLoading });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const mutation = useMutation({
    mutationFn: () => createList({ title, description, visibility }, token!),
    onSuccess: () => { void trackEvent('list_created', { visibility }, token); setTitle(''); setDescription(''); setVisibility('public'); void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  const saveMutation = useMutation({
    mutationFn: (listId: string) => addListItem(listId, { branchId: placeId! }, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  const apiLists = data?.lists ?? [];
  const scopedLists = placeId && user ? apiLists.filter((list) => list.owner.id === user.id || list.canEdit) : apiLists;
  const visibleLists: List[] = scopedLists.length ? scopedLists : (!user && isDemoMode() ? fixtureLists : []);

  if (authLoading) return <View style={styles.center}><Text style={styles.loadingText}>Cargando tus listas…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tus listas" detail="Tus listas siguen guardadas. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;

  const header = <View>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CURADURÍA PERSONAL</Text><Text style={styles.title}>Tus listas</Text></View><Ionicons name="albums-outline" size={22} color={colors.tortilla} /></View>
    <Text style={styles.intro}>{placeId ? 'Elige una lista para guardar esta taquería. Después podrás volver a ella desde tu perfil.' : 'Guarda lugares por antojo, colonia o estado de ánimo. Las listas convierten tus visitas en una forma de recomendar.'}</Text>
    {user ? <View style={styles.createCard}><Text style={styles.createEyebrow}>NUEVA LISTA</Text><TextInput value={title} onChangeText={setTitle} placeholder="Ej. Pastor que sí defendería" placeholderTextColor={colors.textTertiary} style={styles.input} maxLength={80} /><TextInput value={description} onChangeText={setDescription} placeholder="Una descripción breve (opcional)" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.descriptionInput]} maxLength={240} multiline /><View style={styles.visibilityRow}><Text style={styles.visibilityLabel}>VISIBILIDAD</Text><View style={styles.visibilityOptions}><Pressable onPress={() => setVisibility('public')} style={[styles.visibilityOption, visibility === 'public' && styles.visibilityActive]}><Ionicons name="globe-outline" size={13} color={visibility === 'public' ? colors.background : colors.textSecondary} /><Text style={[styles.visibilityText, visibility === 'public' && styles.visibilityTextActive]}>Pública</Text></Pressable><Pressable onPress={() => setVisibility('private')} style={[styles.visibilityOption, visibility === 'private' && styles.visibilityActive]}><Ionicons name="lock-closed-outline" size={13} color={visibility === 'private' ? colors.background : colors.textSecondary} /><Text style={[styles.visibilityText, visibility === 'private' && styles.visibilityTextActive]}>Privada</Text></Pressable></View></View><Pressable style={[styles.createButton, (!title.trim() || mutation.isPending) && styles.disabled]} disabled={!title.trim() || mutation.isPending} onPress={() => mutation.mutate()}><Ionicons name="add" size={18} color={colors.background} /><Text style={styles.createButtonText}>{mutation.isPending ? 'Guardando…' : 'Crear lista'}</Text></Pressable></View> : <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="person-add-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Crea listas públicas</Text><Text style={styles.loginDetail}>Entra para guardar lugares y compartir tu criterio.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textSecondary} /></Pressable>}
    <View style={styles.listHeader}><Text style={styles.sectionTitle}>{placeId ? 'Elige una lista' : 'Selecciones'}</Text><Text style={styles.count}>{visibleLists.length} LISTAS</Text></View>
    {mutation.isError ? <Text style={styles.error}>No pudimos crear la lista. Inténtalo de nuevo.</Text> : null}
    {saveMutation.isError ? <Text style={styles.error}>No pudimos guardar el lugar en esa lista.</Text> : null}
  </View>;
  const empty = <View style={styles.empty}><Ionicons name="bookmark-outline" size={25} color={colors.textTertiary} /><Text style={styles.emptyTitle}>Todavía no tienes listas</Text><Text style={styles.emptyText}>Crea la primera y empieza a construir tu mapa de antojos.</Text></View>;
  return <FlatList data={visibleLists} keyExtractor={(list) => list.id} renderItem={({ item }) => <ListCard list={item} saveMode={Boolean(placeId)} saved={saveMutation.isSuccess && saveMutation.variables === item.id} onPress={placeId ? () => { if (user) saveMutation.mutate(item.id); else router.push({ pathname: '/auth', params: { returnTo: '/lists', placeId } }); } : () => router.push(`/list/${item.id}`)} />} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} ListEmptyComponent={empty} showsVerticalScrollIndicator={false} />;
}

function ListCard({ list, saveMode, saved, onPress }: { list: List; saveMode?: boolean; saved?: boolean; onPress?: () => void }) {
  const progress = list.itemCount ? Math.round((list.visitedCount / list.itemCount) * 100) : 0;
  return <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress} disabled={!onPress}><CatalogImage uri={list.coverImage} accessibilityLabel={`Imagen de ${list.title}`} style={styles.cover} /><View style={styles.cardShade} /><View style={styles.cardCopy}><Text style={styles.cardTitle}>{list.title}</Text><Text style={styles.cardDescription}>{list.description}</Text><View style={styles.cardMeta}><Text style={styles.owner}>por @{list.owner.displayName.toLowerCase().replace(/\s+/g, '')}</Text><Text style={styles.progress}>{saveMode ? (saved ? 'GUARDADO ✓' : 'TOCA PARA GUARDAR') : `${list.visitedCount}/${list.itemCount} VISITADOS · ${progress}%${list.visibility === 'private' ? ' · PRIVADA' : ''}`}</Text></View></View></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.lg },
  back: { width: 42, height: 42, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 30, fontWeight: typography.weight.bold, letterSpacing: -1, marginTop: 3 },
  intro: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 14, lineHeight: 21, marginBottom: spacing.xl },
  createCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.xl, ...shadows.card },
  createEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.4, marginBottom: spacing.sm },
  input: { height: 48, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.borderStrong, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, paddingHorizontal: 13, fontSize: 13, marginBottom: spacing.sm },
  descriptionInput: { minHeight: 48, paddingTop: 13, textAlignVertical: 'top' },
  visibilityRow: { marginTop: 4, marginBottom: 12 },
  visibilityLabel: { color: colors.textTertiary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.2, marginBottom: 7 },
  visibilityOptions: { flexDirection: 'row', gap: 8 },
  visibilityOption: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surfaceElevated },
  visibilityActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  visibilityText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  visibilityTextActive: { color: colors.meatDark },
  createButton: { height: 46, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 2 },
  createButtonText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  disabled: { opacity: 0.4 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tortilla, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.xl },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  loginDetail: { color: colors.meatDark, opacity: 0.72, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 3 },
  listHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 22, fontWeight: typography.weight.semibold },
  count: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  card: { height: 190, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.surfaceElevated, ...shadows.card },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  cover: { width: '100%', height: '100%' },
  cardShade: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  cardCopy: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md },
  cardTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 22, fontWeight: typography.weight.semibold, letterSpacing: -0.5 },
  cardDescription: { color: colors.textPrimary, opacity: 0.78, fontFamily: typography.fontFamily.regular, fontSize: 12, marginTop: 5 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 },
  owner: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold },
  progress: { color: colors.textPrimary, opacity: 0.76, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 0.6 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 17, fontWeight: typography.weight.semibold, marginTop: spacing.md },
  emptyText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 5 },
  error: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, marginBottom: spacing.md }
});
