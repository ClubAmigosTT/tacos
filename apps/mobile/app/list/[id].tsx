import { useEffect } from 'react';
import { Share } from 'react-native';
import * as Linking from 'expo-linking';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, listDetails, removeListItem, trackEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';
import { MapCanvas } from '@/components/MapCanvas';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => { if (id) void trackEvent('list_open', { list_id: id }, token); }, [id, token]);
  const { data: list, isLoading, isError, error, refetch } = useQuery({ queryKey: ['list', id, token], queryFn: () => listDetails(id, token), enabled: Boolean(id && !authLoading) });
  const removeMutation = useMutation({
    mutationFn: (branchId: string) => removeListItem(id, branchId, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['list', id] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  if (authLoading || isLoading) return <View style={styles.center}><Text style={styles.muted}>{authLoading ? 'Preparando la lista…' : 'Cargando lista…'}</Text></View>;
  if (isError && !(error instanceof ApiError && error.status === 404)) return <AsyncErrorState title="No pudimos cargar la lista" detail="La curaduría no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  if (!list) return <View style={styles.center}><Text style={styles.title}>Lista no disponible</Text><Text style={styles.muted}>Puede que sea privada o haya sido eliminada.</Text><Pressable style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>Volver</Text></Pressable></View>;
  const currentList = list;
  const progress = list.itemCount ? Math.round((list.visitedCount / list.itemCount) * 100) : 0;
  const isOwner = Boolean(user && user.id === list.owner.id && token);
  const canEdit = Boolean(list.canEdit || isOwner);
  async function shareList() {
    try { await Share.share({ message: `${currentList.title} · ${currentList.itemCount} lugares en Tacos\n${Linking.createURL(`/list/${currentList.id}`)}` }); } catch { /* Compartir es opcional en plataformas sin hoja nativa. */ }
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.eyebrow}>LISTA CURADA</Text>
        {isOwner ? <View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="Compartir lista" style={styles.edit} onPress={() => void shareList()}><Ionicons name="share-outline" size={19} color={colors.tortilla} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Gestionar colaboradores" style={styles.edit} onPress={() => router.push({ pathname: '/list-collaborators', params: { id: list.id } })}><Ionicons name="people-outline" size={19} color={colors.tortilla} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Editar lista" style={styles.edit} onPress={() => router.push({ pathname: '/list-edit', params: { id: list.id } })}><Ionicons name="create-outline" size={19} color={colors.tortilla} /></Pressable></View> : <View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="Compartir lista" style={styles.edit} onPress={() => void shareList()}><Ionicons name="share-outline" size={19} color={colors.tortilla} /></Pressable><Ionicons accessibilityLabel={list.visibility === 'private' ? 'Lista privada' : 'Lista pública'} name={list.visibility === 'private' ? 'lock-closed' : 'bookmark'} size={20} color={colors.tortilla} /></View>}
      </View>
      <Text style={styles.title}>{list.title}</Text>
      <Text style={styles.description}>{list.description}</Text>
      <View style={styles.metaRow}><Text style={styles.owner}>por @{list.owner.displayName.toLowerCase().replace(/\s+/g, '')}</Text><Text style={styles.progress}>{list.visitedCount}/{list.itemCount} VISITADOS · {progress}%</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
      {isOwner ? <Pressable accessibilityRole="button" accessibilityLabel="Gestionar colaboradores" style={styles.collabLink} onPress={() => router.push({ pathname: '/list-collaborators', params: { id: list.id } })}><Ionicons name="people-outline" size={15} color={colors.tortilla} /><Text style={styles.collabText}>Gestionar colaboradores{list.collaboratorCount ? ` · ${list.collaboratorCount}` : ''}</Text><Ionicons name="chevron-forward" size={14} color={colors.textTertiary} /></Pressable> : (list.collaboratorCount ?? list.collaborators?.length ?? 0) ? <Text style={styles.collabSummary}>{list.collaboratorCount ?? list.collaborators?.length} colaborador{(list.collaboratorCount ?? list.collaborators?.length) === 1 ? '' : 'es'}</Text> : null}
      {list.items.length ? <View style={styles.mapPreview}><MapCanvas places={list.items.map((item) => item.place)} active="" onSelect={(placeId) => router.push(`/place/${placeId}`)} /></View> : null}
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Lugares</Text><Text style={styles.count}>{list.items.length}</Text></View>
      {removeMutation.isError ? <Text style={styles.error}>No pudimos quitar ese lugar. Inténtalo de nuevo.</Text> : null}
      {list.items.length ? list.items.map((item) => <View key={item.branchId} style={styles.item}><PlaceCard place={item.place} compact />{item.note ? <Text style={styles.note}>{item.note}</Text> : null}{canEdit ? <Pressable style={styles.remove} disabled={removeMutation.isPending} onPress={() => removeMutation.mutate(item.branchId)}><Ionicons name="remove-circle-outline" size={15} color={colors.salsa} /><Text style={styles.removeText}>{removeMutation.isPending ? 'Quitando…' : 'Quitar de la lista'}</Text></Pressable> : null}</View>) : <View style={styles.empty}><Ionicons name="map-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyTitle}>Todavía no hay lugares</Text><Text style={styles.muted}>Guarda taquerías desde sus fichas para empezar esta ruta.</Text></View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  edit: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.6 },
  title: { color: colors.textPrimary, fontSize: 31, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -1, lineHeight: 35 },
  description: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, marginTop: 9 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  owner: { color: colors.tortilla, fontSize: 10, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  progress: { color: colors.textSecondary, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 0.6 },
  progressTrack: { height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden', marginTop: 9 },
  progressFill: { height: '100%', backgroundColor: colors.tortilla, borderRadius: 4 },
  collabLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingVertical: 5 },
  collabText: { color: colors.tortilla, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, flex: 1 },
  collabSummary: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  mapPreview: { height: 190, borderRadius: radii.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginTop: spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.xxl, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontSize: 23, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  count: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  item: { marginBottom: spacing.sm },
  note: { color: colors.salsa, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: -4, marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
  remove: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 6 },
  removeText: { color: colors.salsa, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  error: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, marginBottom: spacing.sm },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  backButton: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  backText: { color: colors.background, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }
});
