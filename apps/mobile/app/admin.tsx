import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminReports, reviewReport } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

const statuses = ['open', 'reviewed', 'dismissed', 'all'] as const;
const statusLabels = { open: 'Pendientes', reviewed: 'Resueltos', dismissed: 'Descartados', all: 'Todos' } as const;
const reasonLabels = { spam: 'Spam', inappropriate: 'Contenido inapropiado', wrong_place: 'Lugar incorrecto', other: 'Otro' } as const;

export default function AdminScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>('open');
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-reports', status, token], queryFn: () => adminReports(token!, status), enabled: Boolean(token && user?.role === 'admin') });
  const mutation = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'hide' | 'dismiss' }) => reviewReport(id, action, token!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-reports'] }) });

  if (!user) return <Gate title="Acceso restringido" detail="Entra a tu cuenta para continuar." action="Entrar" onAction={() => router.push('/auth')} />;
  if (user.role !== 'admin') return <Gate title="No tienes acceso" detail="Esta sección está reservada para el equipo de revisión." action="Volver" onAction={() => router.back()} />;
  const reports = data?.reports ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTROL DE CALIDAD</Text><Text style={styles.title}>Moderación</Text></View><Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} /></View><Text style={styles.intro}>Revisa reportes de la comunidad y decide si un registro debe desaparecer del feed.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{statuses.map((option) => <Pressable key={option} onPress={() => setStatus(option)} style={[styles.filter, option === status && styles.filterActive]}><Text style={[styles.filterText, option === status && styles.filterTextActive]}>{statusLabels[option]}</Text></Pressable>)}</ScrollView>{isLoading ? <Text style={styles.muted}>Cargando reportes…</Text> : isError ? <Text style={styles.error}>No pudimos cargar la cola de moderación.</Text> : reports.length ? reports.map((report) => <View style={styles.report} key={report.id}><View style={styles.reportHeader}><View style={styles.reportBadge}><Ionicons name="flag-outline" size={14} color={colors.background} /></View><View style={styles.reportCopy}><Text style={styles.reason}>{reasonLabels[report.reason]}</Text><Text style={styles.reportMeta}>{new Date(report.createdAt).toLocaleDateString('es-MX')} · {report.status}</Text></View><Text style={styles.rating}>{report.rating.toFixed(1)}</Text></View><Text style={styles.place}>{report.place.name}</Text><Text style={styles.author}>Por {report.author.displayName} · reportó {report.reporter.displayName}</Text>{report.details ? <Text style={styles.details}>{report.details}</Text> : null}{report.status === 'open' ? <View style={styles.actions}><Pressable style={styles.dismiss} disabled={mutation.isPending} onPress={() => mutation.mutate({ id: report.id, action: 'dismiss' })}><Text style={styles.dismissText}>Descartar</Text></Pressable><Pressable style={styles.hide} disabled={mutation.isPending} onPress={() => mutation.mutate({ id: report.id, action: 'hide' })}><Ionicons name="eye-off-outline" size={15} color={colors.background} /><Text style={styles.hideText}>Ocultar del feed</Text></Pressable></View> : null}</View>) : <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={30} color={colors.accent} /><Text style={styles.emptyTitle}>No hay reportes</Text><Text style={styles.muted}>{status === 'open' ? 'La cola está limpia por ahora.' : 'No encontramos registros con este estado.'}</Text></View>}</ScrollView>;
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
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.8, marginTop: 3, textAlign: 'center' },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
  filters: { gap: 8, paddingBottom: spacing.md },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  filterTextActive: { color: colors.background },
  report: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  reportCopy: { flex: 1 },
  reason: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  reportMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  rating: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  place: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.md },
  author: { color: colors.muted, fontSize: 11, marginTop: 4 },
  details: { color: colors.warm, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  dismiss: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  hide: { flex: 1, minHeight: 42, backgroundColor: colors.accent, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  hideText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  empty: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: 'center', padding: spacing.xl, marginTop: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.sm },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.md },
  gate: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  gateIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }
});
