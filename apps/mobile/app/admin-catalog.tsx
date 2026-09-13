import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminCatalogProposals, reviewCatalogProposal, type CatalogProposal } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { colors, radii, spacing, typography } from '@/theme';

const filters = ['pending', 'approved', 'rejected', 'all'] as const;
const filterLabels = { pending: 'Pendientes', approved: 'Aprobadas', rejected: 'Rechazadas', all: 'Todas' } as const;
const kindLabels = { branch: 'Nueva taquería', menu_item: 'Nuevo taco', correction: 'Corrección' } as const;

export default function AdminCatalogScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof filters)[number]>('pending');
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-catalog', status, token], queryFn: () => adminCatalogProposals(token!, status), enabled: Boolean(token && user?.role === 'admin') });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => reviewCatalogProposal(id, action, token!, reviewNote.trim()),
    onSuccess: () => { setReviewNote(''); setError(''); void queryClient.invalidateQueries({ queryKey: ['admin-catalog'] }); },
    onError: () => setError('No pudimos actualizar la propuesta. Revisa la conexión e inténtalo de nuevo.')
  });

  if (!user) return <Gate title="Acceso restringido" detail="Entra a tu cuenta para continuar." action="Entrar" onAction={() => router.push('/auth')} />;
  if (user.role !== 'admin') return <Gate title="No tienes acceso" detail="Esta sección está reservada para el equipo de revisión." action="Volver" onAction={() => router.back()} />;
  if (isError) return <AsyncErrorState title="No pudimos cargar el catálogo pendiente" detail="Las propuestas no se modificaron. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const proposals = data?.proposals ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTROL DE CALIDAD</Text><Text style={styles.title}>Catálogo</Text></View><Ionicons name="map-outline" size={22} color={colors.tortilla} /></View><Text style={styles.intro}>Revisa las propuestas antes de hacerlas visibles para toda la comunidad. La aprobación deja trazabilidad de quién y cuándo publicó el dato.</Text><TextInput accessibilityLabel="Nota de revisión" value={reviewNote} onChangeText={setReviewNote} style={styles.noteInput} placeholder="Nota para la propuesta (opcional)" placeholderTextColor={colors.textTertiary} maxLength={500} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: status === option }} onPress={() => setStatus(option)} style={[styles.filter, status === option && styles.filterActive]}><Text style={[styles.filterText, status === option && styles.filterTextActive]}>{filterLabels[option]}</Text></Pressable>)}</ScrollView>{isLoading ? <Text style={styles.muted}>Cargando propuestas…</Text> : proposals.length ? proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} pending={mutation.isPending} onReview={(action) => { setError(''); mutation.mutate({ id: proposal.id, action }); }} />) : <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={30} color={colors.tortilla} /><Text style={styles.emptyTitle}>No hay propuestas</Text><Text style={styles.muted}>{status === 'pending' ? 'La cola está limpia por ahora.' : 'No encontramos propuestas con este estado.'}</Text></View>}{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}</ScrollView>;
}

function ProposalCard({ proposal, pending, onReview }: { proposal: CatalogProposal; pending: boolean; onReview: (action: 'approve' | 'reject') => void }) {
  const payload = proposal.payload;
  const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes as Record<string, unknown> : undefined;
  const summary = proposal.kind === 'branch'
    ? `${text(payload, 'name') || 'Sin nombre'} · ${text(payload, 'neighborhood') || 'Sin colonia'}`
    : proposal.kind === 'menu_item'
      ? `${text(payload, 'name') || 'Sin nombre'} · ${number(payload, 'price') != null ? `$${number(payload, 'price')}` : 'precio no indicado'}`
      : Object.entries(changes ?? payload).map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
  return <View style={styles.card}><View style={styles.cardTop}><View style={styles.badge}><Ionicons name={proposal.kind === 'branch' ? 'location-outline' : proposal.kind === 'menu_item' ? 'restaurant-outline' : 'create-outline'} size={15} color={colors.background} /></View><View style={styles.cardCopy}><Text style={styles.kind}>{kindLabels[proposal.kind]}</Text><Text style={styles.meta}>{new Date(proposal.createdAt).toLocaleDateString('es-MX')} · {proposal.status}</Text></View></View><Text style={styles.summary}>{summary}</Text>{proposal.branchId ? <Text style={styles.detail}>Sucursal: {proposal.branchId}</Text> : null}{proposal.proposer ? <Text style={styles.detail}>Por {proposal.proposer.displayName}</Text> : null}{proposal.evidenceUrl ? <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(proposal.evidenceUrl!)}><Text style={styles.evidence}>Abrir evidencia ↗</Text></Pressable> : <Text style={styles.detail}>Sin evidencia adjunta</Text>}{proposal.reviewNote ? <Text style={styles.reviewNote}>Nota: {proposal.reviewNote}</Text> : null}{proposal.status === 'pending' ? <View style={styles.actions}><Pressable accessibilityRole="button" disabled={pending} style={styles.reject} onPress={() => onReview('reject')}><Text style={styles.rejectText}>Rechazar</Text></Pressable><Pressable accessibilityRole="button" disabled={pending} style={styles.approve} onPress={() => onReview('approve')}><Ionicons name="checkmark" size={15} color={colors.meatDark} /><Text style={styles.approveText}>Aprobar</Text></Pressable></View> : null}</View>;
}

function text(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === 'string' ? payload[key] as string : '';
}

function number(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value == null || value === '' ? undefined : Number(value);
}

function Gate({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <View style={styles.gate}><View style={styles.gateIcon}><Ionicons name="shield-outline" size={26} color={colors.background} /></View><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{detail}</Text><Pressable style={styles.approve} onPress={onAction}><Text style={styles.approveText}>{action}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 29, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 3, textAlign: 'center' },
  intro: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, marginBottom: spacing.md },
  noteInput: { minHeight: 46, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 12, marginBottom: spacing.md },
  filters: { gap: 8, paddingBottom: spacing.md },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  filterText: { color: colors.textPrimary, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  filterTextActive: { color: colors.meatDark },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1 },
  kind: { color: colors.textPrimary, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  meta: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.fontFamily.regular, marginTop: 3 },
  summary: { color: colors.textPrimary, fontSize: 14, fontFamily: typography.fontFamily.semibold, lineHeight: 20, marginTop: spacing.md },
  detail: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 17, marginTop: 4 },
  evidence: { color: colors.tortilla, fontSize: 11, fontFamily: typography.fontFamily.bold, marginTop: 6 },
  reviewNote: { color: colors.salsa, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 17, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  reject: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  approve: { flex: 1, minHeight: 42, borderRadius: radii.sm, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  approveText: { color: colors.meatDark, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  error: { color: colors.danger, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: spacing.md },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl, marginTop: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.sm },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  gate: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  gateIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }
});
