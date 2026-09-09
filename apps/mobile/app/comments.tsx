import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createComment, deleteComment, visitComments } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function CommentsScreen() {
  const { visitId, placeName } = useLocalSearchParams<{ visitId?: string; placeName?: string }>();
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['comments', visitId, token], queryFn: () => visitComments(visitId!, token!), enabled: Boolean(token && visitId && !authLoading) });
  const createMutation = useMutation({
    mutationFn: () => createComment(visitId!, body.trim(), token!),
    onSuccess: () => { setBody(''); void queryClient.invalidateQueries({ queryKey: ['comments', visitId] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); },
    onError: () => Alert.alert('No pudimos publicar la nota', 'Revisa la conexión e inténtalo de nuevo.')
  });
  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['comments', visitId] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); },
    onError: () => Alert.alert('No pudimos borrar la nota', 'Revisa la conexión e inténtalo de nuevo.')
  });

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando conversación…</Text></View>;
  if (!token) return <View style={styles.center}><View style={styles.icon}><Ionicons name="chatbubble-ellipses-outline" size={24} color={colors.background} /></View><Text style={styles.title}>Entra para comentar</Text><Text style={styles.muted}>Sigue la conversación alrededor de cada descubrimiento.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/comments', ...(visitId ? { visitId } : {}), ...(placeName ? { placeName } : {}) } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text></Pressable></View>;
  if (!visitId) return <View style={styles.center}><Text style={styles.title}>Conversación no disponible</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Volver</Text></Pressable></View>;
  if (isError) return <AsyncErrorState title="No pudimos cargar la conversación" detail="Los comentarios siguen intactos. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const comments = data?.comments ?? [];
  function confirmDelete(commentId: string) {
    Alert.alert('Borrar comentario', 'Esta acción no se puede deshacer.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Borrar', style: 'destructive', onPress: () => deleteMutation.mutate(commentId) }]);
  }
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONVERSACIÓN</Text><Text style={styles.headerTitle} numberOfLines={1}>{placeName ?? 'Visita'}</Text></View><Ionicons name="chatbubble-ellipses-outline" size={21} color={colors.accent} /></View><Text style={styles.intro}>Notas y recomendaciones de la comunidad alrededor de esta visita.</Text>{isLoading ? <Text style={styles.muted}>Cargando comentarios…</Text> : comments.length ? <View style={styles.list}>{comments.map((comment) => <View key={comment.id} style={styles.comment}><View style={styles.avatar}><Text style={styles.avatarText}>{comment.author.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.commentCopy}><View style={styles.commentTop}><Text style={styles.author}>{comment.author.displayName}</Text><Text style={styles.date}>{new Date(comment.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</Text></View><Text style={styles.commentBody}>{comment.body}</Text>{comment.own ? <Pressable style={styles.delete} disabled={deleteMutation.isPending} onPress={() => confirmDelete(comment.id)}><Ionicons name="trash-outline" size={13} color={colors.warm} /><Text style={styles.deleteText}>Borrar</Text></Pressable> : null}</View></View>)}</View> : <View style={styles.empty}><Ionicons name="chatbubble-outline" size={27} color={colors.dim} /><Text style={styles.emptyTitle}>Sé el primero en comentar</Text><Text style={styles.muted}>Comparte una recomendación breve para la próxima visita.</Text></View>}</ScrollView><View style={styles.composer}><TextInput value={body} onChangeText={setBody} placeholder="Escribe una nota…" placeholderTextColor={colors.dim} style={styles.input} maxLength={500} multiline /><Pressable style={[styles.send, (!body.trim() || createMutation.isPending) && styles.disabled]} disabled={!body.trim() || createMutation.isPending} onPress={() => createMutation.mutate()}><Ionicons name="arrow-up" size={18} color={colors.background} /></Pressable></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerCopy: { flex: 1, paddingHorizontal: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 3 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  list: { gap: spacing.md },
  comment: { flexDirection: 'row', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontWeight: '900' },
  commentCopy: { flex: 1 },
  commentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  date: { color: colors.dim, fontSize: 10 },
  commentBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  delete: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8 },
  deleteText: { color: colors.warm, fontSize: 10, fontWeight: '800' },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl, marginTop: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, color: colors.ink, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  icon: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  primary: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 52, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  secondaryText: { color: colors.accent, fontSize: 12, fontWeight: '900' }
});
