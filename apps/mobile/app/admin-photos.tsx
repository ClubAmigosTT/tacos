import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { adminBranchPhotos, reviewBranchPhoto, type AdminBranchPhoto } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { CatalogImage } from '@/components/CatalogImage';
import { colors, radii, spacing, typography } from '@/theme';

const statuses = ['pending', 'approved', 'rejected', 'all'] as const;
const statusLabels = { pending: 'Pendientes', approved: 'Aprobadas', rejected: 'Rechazadas', all: 'Todas' } as const;
const sourceLabels = { community: 'Comunidad', owner: 'Negocio', catalog: 'Catálogo' } as const;

export default function AdminPhotosScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>('pending');
  const [moderationNote, setModerationNote] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-photos', status, token], queryFn: () => adminBranchPhotos(token!, status), enabled: Boolean(token && user?.role === 'admin') });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => reviewBranchPhoto(id, action, token!, moderationNote.trim()),
    onSuccess: () => { setModerationNote(''); void queryClient.invalidateQueries({ queryKey: ['admin-photos'] }); void queryClient.invalidateQueries({ queryKey: ['place'] }); void queryClient.invalidateQueries({ queryKey: ['discover'] }); },
  });

  if (!user) return <Gate title="Acceso restringido" detail="Entra a tu cuenta para continuar." action="Entrar" onAction={() => router.push('/auth')} />;
  if (user.role !== 'admin') return <Gate title="No tienes acceso" detail="Esta sección está reservada para el equipo de revisión." action="Volver" onAction={() => router.back()} />;
  if (isError) return <AsyncErrorState title="No pudimos cargar las fotos" detail="La cola de fotos no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const photos = data?.photos ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTROL DE CALIDAD</Text><Text style={styles.title}>Fotos</Text></View><Ionicons name="images-outline" size={22} color={colors.tortilla} /></View><Text style={styles.intro}>Las fotos de usuarios y negocios se revisan antes de aparecer en el catálogo. Acepta solo imágenes propias o con permiso.</Text><TextInput accessibilityLabel="Nota de moderación" value={moderationNote} onChangeText={setModerationNote} style={styles.noteInput} placeholder="Nota de revisión (opcional)" placeholderTextColor={colors.textTertiary} maxLength={500} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{statuses.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: status === option }} onPress={() => setStatus(option)} style={[styles.filter, status === option && styles.filterActive]}><Text style={[styles.filterText, status === option && styles.filterTextActive]}>{statusLabels[option]}</Text></Pressable>)}</ScrollView>{isLoading ? <Text style={styles.muted}>Cargando fotos…</Text> : photos.length ? photos.map((photo) => <PhotoCard key={photo.id} photo={photo} pending={mutation.isPending} onReview={(action) => mutation.mutate({ id: photo.id, action })} />) : <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={30} color={colors.tortilla} /><Text style={styles.emptyTitle}>No hay fotos</Text><Text style={styles.muted}>{status === 'pending' ? 'La cola está limpia por ahora.' : 'No encontramos fotos con este estado.'}</Text></View>}</ScrollView>;
}

function PhotoCard({ photo, pending, onReview }: { photo: AdminBranchPhoto; pending: boolean; onReview: (action: 'approve' | 'reject') => void }) {
  function openSource() {
    if (photo.sourceUrl) void Linking.openURL(photo.sourceUrl);
  }
  return <View style={styles.card}><CatalogImage uri={photo.url} fallbackLabel="Foto no disponible" accessibilityLabel={`Foto de ${photo.place.name}`} style={styles.photo} /><View style={styles.cardBody}><View style={styles.cardHeader}><View style={styles.cardCopy}><Text style={styles.place}>{photo.place.name}</Text><Text style={styles.meta}>{photo.place.neighborhood} · {sourceLabels[photo.sourceType]} · {new Date(photo.createdAt).toLocaleDateString('es-MX')}</Text></View><View style={styles.statusBadge}><Text style={styles.statusText}>{photo.status}</Text></View></View><Text style={styles.attribution}>{photo.attribution}</Text>{photo.uploader ? <Text style={styles.detail}>Enviada por {photo.uploader.displayName}</Text> : null}{photo.sourceUrl ? <Pressable onPress={openSource}><Text style={styles.sourceLink}>Abrir fuente ↗</Text></Pressable> : null}{photo.moderationNote ? <Text style={styles.note}>Nota: {photo.moderationNote}</Text> : null}{photo.status === 'pending' ? <View style={styles.actions}><Pressable accessibilityRole="button" disabled={pending} style={styles.reject} onPress={() => onReview('reject')}><Text style={styles.rejectText}>Rechazar</Text></Pressable><Pressable accessibilityRole="button" disabled={pending} style={styles.approve} onPress={() => onReview('approve')}><Ionicons name="checkmark" size={15} color={colors.meatDark} /><Text style={styles.approveText}>Aprobar</Text></Pressable></View> : null}</View></View>;
}

function Gate({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <View style={styles.gate}><View style={styles.gateIcon}><Ionicons name="shield-outline" size={26} color={colors.meatDark} /></View><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{detail}</Text><Pressable style={styles.approve} onPress={onAction}><Text style={styles.approveText}>{action}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { alignItems: 'center' },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.bold, fontSize: 9, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 29, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 3, textAlign: 'center' },
  intro: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  noteInput: { minHeight: 46, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 12, marginBottom: spacing.md },
  filters: { gap: 8, paddingBottom: spacing.md },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  filterText: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold },
  filterTextActive: { color: colors.meatDark },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md },
  photo: { width: '100%', height: 210, backgroundColor: colors.surfaceRaised },
  cardBody: { padding: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardCopy: { flex: 1 },
  place: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 16, fontWeight: typography.weight.bold },
  meta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: 3 },
  statusBadge: { borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { color: colors.tortilla, fontFamily: typography.fontFamily.bold, fontSize: 9, fontWeight: typography.weight.bold, textTransform: 'uppercase' },
  attribution: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 11, lineHeight: 17, marginTop: spacing.sm },
  detail: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 4 },
  sourceLink: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 11, marginTop: 7 },
  note: { color: colors.salsa, fontFamily: typography.fontFamily.regular, fontSize: 11, lineHeight: 17, marginTop: 7 },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  reject: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: colors.textSecondary, fontFamily: typography.fontFamily.bold, fontSize: 12, fontWeight: typography.weight.bold },
  approve: { flex: 1, minHeight: 43, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  approveText: { color: colors.meatDark, fontFamily: typography.fontFamily.bold, fontSize: 12, fontWeight: typography.weight.bold },
  empty: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: 'center', padding: spacing.xl, marginTop: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 17, fontWeight: typography.weight.bold, marginTop: spacing.sm },
  muted: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  gate: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  gateIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }
});
