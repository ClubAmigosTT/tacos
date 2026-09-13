import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminAnalytics, adminReports, reviewReport } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { colors, radii, spacing, typography } from '@/theme';

const statuses = ['open', 'reviewed', 'dismissed', 'all'] as const;
const statusLabels = { open: 'Pendientes', reviewed: 'Resueltos', dismissed: 'Descartados', all: 'Todos' } as const;
const reasonLabels = { spam: 'Spam', inappropriate: 'Contenido inapropiado', wrong_place: 'Lugar incorrecto', other: 'Otro' } as const;

export default function AdminScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>('open');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-reports', status, token], queryFn: () => adminReports(token!, status), enabled: Boolean(token && user?.role === 'admin') });
  const { data: analyticsData, isError: analyticsError, refetch: refetchAnalytics } = useQuery({ queryKey: ['admin-analytics', token], queryFn: () => adminAnalytics(token!), enabled: Boolean(token && user?.role === 'admin'), staleTime: 60_000 });
  const mutation = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'hide' | 'dismiss' }) => reviewReport(id, action, token!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-reports'] }), onError: () => Alert.alert('No pudimos actualizar el reporte', 'Revisa la conexión e inténtalo de nuevo.') });

  if (!user) return <Gate title="Acceso restringido" detail="Entra a tu cuenta para continuar." action="Entrar" onAction={() => router.push('/auth')} />;
  if (user.role !== 'admin') return <Gate title="No tienes acceso" detail="Esta sección está reservada para el equipo de revisión." action="Volver" onAction={() => router.back()} />;
  if (isError) return <AsyncErrorState title="No pudimos cargar la moderación" detail="La cola de reportes no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const reports = data?.reports ?? [];
  const analytics = analyticsData?.analytics;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTROL DE CALIDAD</Text><Text style={styles.title}>Moderación</Text></View><Ionicons name="shield-checkmark-outline" size={22} color={colors.tortilla} /></View><Text style={styles.intro}>Revisa reportes de la comunidad y decide si un registro debe desaparecer del feed.</Text>{analyticsError ? <View style={styles.analyticsError}><Text style={styles.analyticsErrorText}>No pudimos cargar las señales de producto.</Text><Pressable accessibilityRole="button" accessibilityLabel="Reintentar analítica" onPress={() => void refetchAnalytics()}><Text style={styles.analyticsRetry}>Reintentar</Text></Pressable></View> : analytics ? <View style={styles.analyticsCard}><View style={styles.analyticsHeader}><View><Text style={styles.analyticsEyebrow}>SEÑALES DE PRODUCTO</Text><Text style={styles.analyticsTitle}>Últimos {analytics.days} días</Text></View><View style={styles.analyticsTotals}><Text style={styles.analyticsNumber}>{analytics.totalEvents}</Text><Text style={styles.analyticsLabel}>eventos</Text></View><View style={styles.analyticsTotals}><Text style={styles.analyticsNumber}>{analytics.uniqueAudiences}</Text><Text style={styles.analyticsLabel}>personas</Text></View></View>{analytics.byEvent.slice(0, 4).map((event) => <View style={styles.analyticsRow} key={event.eventName}><Text style={styles.analyticsEvent}>{event.eventName.replaceAll('_', ' ')}</Text><Text style={styles.analyticsCount}>{event.count}</Text></View>)}</View> : null}<Pressable accessibilityRole="button" accessibilityLabel="Revisar fotos de la comunidad" style={styles.commentsLink} onPress={() => router.push('/admin-photos')}><Ionicons name="images-outline" size={16} color={colors.tortilla} /><Text style={styles.commentsLinkText}>Revisar fotos de la comunidad</Text><Ionicons name="chevron-forward" size={15} color={colors.textTertiary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Revisar propuestas del catálogo" style={styles.commentsLink} onPress={() => router.push('/admin-catalog')}><Ionicons name="map-outline" size={16} color={colors.tortilla} /><Text style={styles.commentsLinkText}>Revisar catálogo comunitario</Text><Ionicons name="chevron-forward" size={15} color={colors.textTertiary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Moderar comentarios" style={styles.commentsLink} onPress={() => router.push('/admin-comments')}><Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.tortilla} /><Text style={styles.commentsLinkText}>Moderar comentarios</Text><Ionicons name="chevron-forward" size={15} color={colors.textTertiary} /></Pressable><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{statuses.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Filtrar reportes: ${statusLabels[option]}`} accessibilityState={{ selected: option === status }} onPress={() => setStatus(option)} style={[styles.filter, option === status && styles.filterActive]}><Text style={[styles.filterText, option === status && styles.filterTextActive]}>{statusLabels[option]}</Text></Pressable>)}</ScrollView>{isLoading ? <Text style={styles.muted}>Cargando reportes…</Text> : reports.length ? reports.map((report) => <View style={styles.report} key={report.id}><View style={styles.reportHeader}><View style={styles.reportBadge}><Ionicons name="flag-outline" size={14} color={colors.background} /></View><View style={styles.reportCopy}><Text style={styles.reason}>{reasonLabels[report.reason]}</Text><Text style={styles.reportMeta}>{new Date(report.createdAt).toLocaleDateString('es-MX')} · {report.status}</Text></View><Text style={styles.rating}>{report.rating.toFixed(1)}</Text></View><Text style={styles.place}>{report.place.name}</Text><Text style={styles.author}>Por {report.author.displayName} · reportó {report.reporter.displayName}</Text>{report.details ? <Text style={styles.details}>{report.details}</Text> : null}{report.status === 'open' ? <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel="Descartar reporte" style={styles.dismiss} disabled={mutation.isPending} onPress={() => mutation.mutate({ id: report.id, action: 'dismiss' })}><Text style={styles.dismissText}>Descartar</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Ocultar visita reportada del feed" style={styles.hide} disabled={mutation.isPending} onPress={() => mutation.mutate({ id: report.id, action: 'hide' })}><Ionicons name="eye-off-outline" size={15} color={colors.background} /><Text style={styles.hideText}>Ocultar del feed</Text></Pressable></View> : null}</View>) : <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={30} color={colors.tortilla} /><Text style={styles.emptyTitle}>No hay reportes</Text><Text style={styles.muted}>{status === 'open' ? 'La cola está limpia por ahora.' : 'No encontramos registros con este estado.'}</Text></View>}</ScrollView>;
}

function Gate({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <View style={styles.gate}><View style={styles.gateIcon}><Ionicons name="shield-outline" size={26} color={colors.background} /></View><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{detail}</Text><Pressable style={styles.hide} onPress={onAction}><Text style={styles.hideText}>{action}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 29, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 3, textAlign: 'center' },
  intro: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, marginBottom: spacing.lg },
  commentsLink: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.md },
  commentsLinkText: { color: colors.textPrimary, flex: 1, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  analyticsCard: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  analyticsHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 15, marginBottom: spacing.md },
  analyticsEyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.3 },
  analyticsTitle: { color: colors.textPrimary, fontSize: 16, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 3 },
  analyticsTotals: { alignItems: 'flex-end' },
  analyticsNumber: { color: colors.textPrimary, fontSize: 18, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  analyticsLabel: { color: colors.textSecondary, fontSize: 9, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  analyticsRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 },
  analyticsEvent: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, textTransform: 'capitalize' },
  analyticsCount: { color: colors.tortilla, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  analyticsError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  analyticsErrorText: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 16, flex: 1 },
  analyticsRetry: { color: colors.tortilla, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  filters: { gap: 8, paddingBottom: spacing.md },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  filterText: { color: colors.textPrimary, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  filterTextActive: { color: colors.background },
  report: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  reportCopy: { flex: 1 },
  reason: { color: colors.textPrimary, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  reportMeta: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.fontFamily.regular, marginTop: 3 },
  rating: { color: colors.tortilla, fontSize: 16, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  place: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.md },
  author: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: 4 },
  details: { color: colors.salsa, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 18, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  dismiss: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  hide: { flex: 1, minHeight: 42, backgroundColor: colors.tortilla, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  hideText: { color: colors.background, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  empty: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: 'center', padding: spacing.xl, marginTop: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.sm },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  error: { color: colors.danger, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: spacing.md },
  gate: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  gateIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }
});
