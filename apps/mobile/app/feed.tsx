import { router } from 'expo-router';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { feed as feedRequest, reportVisit, trackEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function FeedScreen() {
  const { token, user, loading: authLoading } = useAuth();
  useEffect(() => { void trackEvent('feed_open', {}, token); }, [token]);
  const { data, isError, refetch } = useQuery({ queryKey: ['feed', token], queryFn: () => feedRequest(token!), enabled: Boolean(token && !authLoading) });
  const items = data?.items ?? [];
  const reportMutation = useMutation({ mutationFn: (visitId: string) => reportVisit({ visitId, reason: 'other' }, token!), onSuccess: () => Alert.alert('Gracias', 'Revisaremos este registro.'), onError: () => Alert.alert('No se pudo reportar', 'Inténtalo de nuevo más tarde.') });
  function openReport(visitId: string) {
    Alert.alert('Reportar registro', '¿Qué quieres reportar?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Reportar', style: 'destructive', onPress: () => reportMutation.mutate(visitId) }]);
  }
  if (authLoading) return <View style={styles.center}><Text style={styles.loadingText}>Cargando tu actividad…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tu actividad" detail="Tus conexiones siguen intactas. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>SEÑALES DE CONFIANZA</Text><Text style={styles.title}>Actividad</Text></View><Pressable style={styles.peopleButton} onPress={() => router.push('/people')}><Ionicons name="person-add-outline" size={18} color={colors.background} /></Pressable></View>
    {!user ? <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="people-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Sigue a gente con criterio</Text><Text style={styles.loginDetail}>Entra para construir un feed a tu medida.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable> : items.length ? items.map((item) => <View style={styles.item} key={item.id}><View style={styles.itemTop}><Pressable style={styles.personIdentity} onPress={() => router.push(`/user/${item.user_id}`)}><View style={styles.avatar}><Text style={styles.avatarText}>{item.display_name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.itemCopy}><Text style={styles.itemTitle}><Text style={styles.bold}>{item.display_name}</Text> registró una visita</Text><Text style={styles.itemTime}>{new Date(item.visited_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</Text></View></Pressable><RatingBadge rating={Number(item.rating)} accent /><Pressable style={styles.reportButton} disabled={reportMutation.isPending} onPress={() => openReport(item.id)}><Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} /></Pressable></View><Pressable style={styles.placeRow} onPress={() => router.push(`/place/${item.place_id}`)}><Image source={{ uri: item.image_url }} style={styles.placeImage} /><View style={styles.placeCopy}><Text style={styles.placeName}>{item.place_name}</Text><Text style={styles.placeMeta}>{item.neighborhood} · {item.tacos || 'Tacos'}</Text></View><Ionicons name="arrow-forward" size={17} color={colors.muted} /></Pressable>{item.note ? <Text style={styles.itemNote}>“{item.note}”</Text> : null}<Pressable style={styles.commentsButton} onPress={() => router.push({ pathname: '/comments', params: { visitId: item.id, placeName: item.place_name } })}><Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.accent} /><Text style={styles.commentsText}>{item.comment_count ? `${item.comment_count} comentario${item.comment_count === 1 ? '' : 's'}` : 'Comentar'}</Text><Ionicons name="chevron-forward" size={14} color={colors.dim} /></Pressable></View>) : <View style={styles.empty}><Ionicons name="people-outline" size={28} color={colors.dim} /><Text style={styles.emptyTitle}>Tu feed está en silencio</Text><Text style={styles.emptyText}>Busca personas y síguelas para ver sus visitas, ratings y descubrimientos.</Text><Pressable style={styles.primary} onPress={() => router.push('/people')}><Text style={styles.primaryText}>Encontrar personas</Text></Pressable></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { color: colors.muted, fontSize: 13 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 3 },
  peopleButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.background, fontSize: 14, fontWeight: '900' },
  loginDetail: { color: colors.background, opacity: 0.7, fontSize: 11, marginTop: 3 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.md },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reportButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontWeight: '900' },
  itemCopy: { flex: 1 },
  itemTitle: { color: colors.ink, fontSize: 13 },
  bold: { fontWeight: '900' },
  itemTime: { color: colors.muted, fontSize: 10, marginTop: 4 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  placeImage: { width: 58, height: 58, borderRadius: 10, backgroundColor: colors.surfaceRaised },
  placeCopy: { flex: 1 },
  placeName: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  placeMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  itemNote: { color: colors.warm, fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  commentsButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  commentsText: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 90, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  primary: { backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: 13, marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' }
});
