import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminComments, reviewComment } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { colors, radii, spacing, typography } from '@/theme';

const filters = ['visible', 'hidden', 'all'] as const;
const labels = { visible: 'Visibles', hidden: 'Ocultos', all: 'Todos' } as const;

export default function AdminCommentsScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<(typeof filters)[number]>('visible');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-comments', visibility, token], queryFn: () => adminComments(token!, visibility), enabled: Boolean(token && user?.role === 'admin') });
  const mutation = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'hide' | 'restore' }) => reviewComment(id, action, token!), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-comments'] }), onError: () => Alert.alert('No pudimos actualizar el comentario', 'Revisa la conexión e inténtalo de nuevo.') });

  if (!user) return <Gate title="Acceso restringido" detail="Entra a tu cuenta para continuar." action="Entrar" onAction={() => router.push('/auth')} />;
  if (user.role !== 'admin') return <Gate title="No tienes acceso" detail="Esta sección está reservada para el equipo de revisión." action="Volver" onAction={() => router.back()} />;
  if (isError) return <AsyncErrorState title="No pudimos cargar los comentarios" detail="La cola de moderación no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const comments = data?.comments ?? [];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTROL DE CALIDAD</Text><Text style={styles.title}>Comentarios</Text></View><Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.tortilla} /></View><Text style={styles.intro}>Oculta comentarios que rompan el tono de la comunidad y restáuralos si la revisión cambia.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map((option) => <Pressable key={option} onPress={() => setVisibility(option)} style={[styles.filter, option === visibility && styles.filterActive]}><Text style={[styles.filterText, option === visibility && styles.filterTextActive]}>{labels[option]}</Text></Pressable>)}</ScrollView>{isLoading ? <Text style={styles.muted}>Cargando comentarios…</Text> : comments.length ? comments.map((comment) => <View style={styles.comment} key={comment.id}><View style={styles.commentHeader}><View style={styles.avatar}><Text style={styles.avatarText}>{comment.author.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.author}>{comment.author.displayName}</Text><Text style={styles.meta}>{comment.place.name} · {new Date(comment.createdAt).toLocaleDateString('es-MX')}</Text></View><View style={[styles.status, comment.visibility === 'hidden' && styles.statusHidden]}><Text style={styles.statusText}>{comment.visibility === 'hidden' ? 'OCULTO' : 'VISIBLE'}</Text></View></View><Text style={styles.body}>{comment.body}</Text><Pressable style={styles.action} disabled={mutation.isPending} onPress={() => mutation.mutate({ id: comment.id, action: comment.visibility === 'hidden' ? 'restore' : 'hide' })}><Ionicons name={comment.visibility === 'hidden' ? 'eye-outline' : 'eye-off-outline'} size={15} color={colors.tortilla} /><Text style={styles.actionText}>{comment.visibility === 'hidden' ? 'Restaurar comentario' : 'Ocultar comentario'}</Text></Pressable></View>) : <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={30} color={colors.tortilla} /><Text style={styles.emptyTitle}>No hay comentarios</Text><Text style={styles.muted}>La cola está limpia para este filtro.</Text></View>}</ScrollView>;
}

function Gate({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <View style={styles.gate}><View style={styles.gateIcon}><Ionicons name="shield-outline" size={26} color={colors.background} /></View><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{detail}</Text><Pressable style={styles.primary} onPress={onAction}><Text style={styles.primaryText}>{action}</Text></Pressable></View>;
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
  filters: { gap: 8, paddingBottom: spacing.md },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  filterText: { color: colors.textPrimary, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  filterTextActive: { color: colors.background },
  comment: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  copy: { flex: 1 },
  author: { color: colors.textPrimary, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  meta: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.fontFamily.regular, marginTop: 3 },
  status: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 4 },
  statusHidden: { backgroundColor: colors.salsa },
  statusText: { color: colors.background, fontSize: 8, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 0.5 },
  body: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, marginTop: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  actionText: { color: colors.tortilla, fontSize: 11, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.sm },
  error: { color: colors.danger, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: spacing.md },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  gate: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  gateIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  primary: { backgroundColor: colors.tortilla, borderRadius: radii.md, minHeight: 48, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }
});
