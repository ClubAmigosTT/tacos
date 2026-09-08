import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listDetails, removeListItem } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: list, isLoading, isError } = useQuery({ queryKey: ['list', id, token], queryFn: () => listDetails(id, token), enabled: Boolean(id) });
  const removeMutation = useMutation({
    mutationFn: (branchId: string) => removeListItem(id, branchId, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['list', id] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); }
  });
  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando lista…</Text></View>;
  if (isError || !list) return <View style={styles.center}><Text style={styles.title}>Lista no disponible</Text><Text style={styles.muted}>Puede que sea privada o haya sido eliminada.</Text><Pressable style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>Volver</Text></Pressable></View>;
  const progress = list.itemCount ? Math.round((list.visitedCount / list.itemCount) * 100) : 0;
  const isOwner = Boolean(user && user.id === list.owner.id && token);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable>
        <Text style={styles.eyebrow}>LISTA CURADA</Text>
        {isOwner ? <Pressable style={styles.edit} onPress={() => router.push({ pathname: '/list-edit', params: { id: list.id } })}><Ionicons name="create-outline" size={20} color={colors.accent} /></Pressable> : <Ionicons name={list.visibility === 'private' ? 'lock-closed' : 'bookmark'} size={20} color={colors.accent} />}
      </View>
      <Text style={styles.title}>{list.title}</Text>
      <Text style={styles.description}>{list.description}</Text>
      <View style={styles.metaRow}><Text style={styles.owner}>por @{list.owner.displayName.toLowerCase().replace(/\s+/g, '')}</Text><Text style={styles.progress}>{list.visitedCount}/{list.itemCount} VISITADOS · {progress}%</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Lugares</Text><Text style={styles.count}>{list.items.length}</Text></View>
      {removeMutation.isError ? <Text style={styles.error}>No pudimos quitar ese lugar. Inténtalo de nuevo.</Text> : null}
      {list.items.length ? list.items.map((item) => <View key={item.branchId} style={styles.item}><PlaceCard place={item.place} compact />{item.note ? <Text style={styles.note}>{item.note}</Text> : null}{isOwner ? <Pressable style={styles.remove} disabled={removeMutation.isPending} onPress={() => removeMutation.mutate(item.branchId)}><Ionicons name="remove-circle-outline" size={15} color={colors.warm} /><Text style={styles.removeText}>{removeMutation.isPending ? 'Quitando…' : 'Quitar de la lista'}</Text></Pressable> : null}</View>) : <View style={styles.empty}><Ionicons name="map-outline" size={28} color={colors.dim} /><Text style={styles.emptyTitle}>Todavía no hay lugares</Text><Text style={styles.muted}>Guarda taquerías desde sus fichas para empezar esta ruta.</Text></View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  edit: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: colors.ink, fontSize: 31, fontWeight: '900', letterSpacing: -1, lineHeight: 35 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 9 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  owner: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  progress: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  progressTrack: { height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden', marginTop: 9 },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.xxl, marginBottom: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 23, fontWeight: '900' },
  count: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  item: { marginBottom: spacing.sm },
  note: { color: colors.warm, fontSize: 11, marginTop: -4, marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
  remove: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 6 },
  removeText: { color: colors.warm, fontSize: 11, fontWeight: '800' },
  error: { color: '#F08A8A', fontSize: 12, marginBottom: spacing.sm },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  backButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  backText: { color: colors.background, fontSize: 12, fontWeight: '900' }
});
