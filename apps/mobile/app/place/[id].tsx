import { useEffect } from 'react';
import { Share } from 'react-native';
import * as Linking from 'expo-linking';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { branchReviews, getPlace, savePlace, savedPlaces, trackEvent, unsavePlace, type BranchReview } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { isOpenNow } from '@/lib/hours';

const flavorLabels = [
  { key: 'intensity', label: 'Intensidad' },
  { key: 'spicy', label: 'Picante' },
  { key: 'traditional', label: 'Tradicional' },
  { key: 'texture', label: 'Textura' },
  { key: 'value', label: 'Valor' }
] as const;

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => { if (id) void trackEvent('place_open', { place_id: id }, token); }, [id, token]);
  const { data: place, isLoading, isError } = useQuery({ queryKey: ['place', id, token], queryFn: () => getPlace(id, token), enabled: Boolean(id && !authLoading) });
  const { data: reviewData, isLoading: reviewsLoading, isError: reviewsError, refetch: refetchReviews } = useQuery({ queryKey: ['branch-reviews', id], queryFn: () => branchReviews(id), enabled: Boolean(id) });
  const { data: savedData } = useQuery({ queryKey: ['saved-places', token], queryFn: () => savedPlaces(token!), enabled: Boolean(token && !authLoading) });
  const savedMutation = useMutation({
    mutationFn: () => savedData?.placeIds.includes(place!.id) ? unsavePlace(place!.id, token!) : savePlace(place!.id, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-places', token] }); }
  });
  if (authLoading || isLoading) return <View style={styles.loading}><Text style={styles.loadingText}>{authLoading ? 'Preparando la ficha…' : 'Cargando lugar…'}</Text></View>;
  if (isError || !place) return <View style={styles.notFound}><Ionicons name="location-outline" size={28} color={colors.accent} /><Text style={styles.notFoundTitle}>Taquería no disponible</Text><Text style={styles.notFoundCopy}>El enlace puede haber cambiado o la sucursal ya no existe.</Text><Pressable style={styles.notFoundButton} onPress={() => router.replace('/(tabs)/map')}><Text style={styles.notFoundButtonText}>Volver al mapa</Text></Pressable></View>;
  const currentPlace = place;
  const averagePrice = place.tacos.length ? Math.round(place.tacos.reduce((sum, taco) => sum + taco.price, 0) / place.tacos.length) : undefined;
  const openNow = isOpenNow(place.openUntil);
  const isSaved = Boolean(id && savedData?.placeIds.includes(id));
  function toggleSaved() {
    if (!token) { router.push({ pathname: '/auth', params: { returnTo: `/place/${id}` } }); return; }
    savedMutation.mutate();
  }
  async function sharePlace() {
    try { await Share.share({ message: `${currentPlace.name} · ${currentPlace.rating.toFixed(2)} en Tacos\n${Linking.createURL(`/place/${currentPlace.id}`)}` }); } catch { /* Compartir es opcional en plataformas sin hoja nativa. */ }
  }
  return <><Stack.Screen options={{ headerShown: false }} /><ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.cover}><Image source={{ uri: place.image }} style={styles.coverImage} /><View style={styles.coverShade} /><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={23} color={colors.ink} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Compartir ficha de ${place.name}`} style={[styles.save, styles.shareButton]} onPress={() => void sharePlace()}><Ionicons name="share-outline" size={19} color={colors.ink} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Guardar ${place.name} en una lista`} style={styles.save} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="bookmark-outline" size={20} color={colors.ink} /></Pressable><View style={styles.coverCopy}><View style={styles.pill}><Text style={styles.pillText}>{place.style.toUpperCase()}</Text></View><Text style={styles.name}>{place.name}</Text><Text style={styles.location}>{place.neighborhood} · {openNow ? 'Abierto ahora' : `Cierra a las ${place.openUntil}`}</Text></View></View><View style={styles.body}><View style={styles.stats}><View><Text style={styles.rating}>{place.rating.toFixed(2)}</Text><Text style={styles.statLabel}>GLOBAL</Text></View><View><Text style={styles.ratingAccent}>{place.match}%</Text><Text style={styles.statLabel}>PARA TI</Text></View><View><Text style={styles.rating}>{averagePrice ? `$${averagePrice}` : '—'}</Text><Text style={styles.statLabel}>PRECIO PROM.</Text></View><View><Text style={styles.rating}>{place.distance}</Text><Text style={styles.statLabel}>DISTANCIA</Text></View></View><Text style={styles.ratingContext}>{place.reviewCount ? `${place.reviewCount} reseñas ponderadas` : 'Reputación de catálogo'}</Text>{place.tasteMatch != null || place.socialMatch != null ? <View accessibilityLabel="Señales de afinidad" style={styles.signalCard}><View style={styles.signalColumn}><Text style={styles.signalValue}>{place.tasteMatch ?? place.match}%</Text><Text style={styles.signalLabel}>GUSTOS SIMILARES</Text></View>{place.socialMatch != null ? <View style={styles.signalColumn}><Text style={styles.signalValue}>{place.socialMatch}%</Text><Text style={styles.signalLabel}>TU CÍRCULO</Text></View> : null}</View> : null}<Text style={styles.description}>{place.description}</Text>{place.taqueriaId ? <Pressable style={styles.parentLink} onPress={() => router.push(`/taqueria/${place.taqueriaId}`)}><Text style={styles.parentLinkText}>Ver {place.taqueriaName ?? 'taquería'} y sus sucursales →</Text></Pressable> : null}<View style={styles.actionRow}><Pressable accessibilityRole="button" accessibilityLabel="Registrar visita" style={styles.primary} onPress={() => router.push({ pathname: '/register', params: { placeId: place.id } })}><Ionicons name="add" size={18} color={colors.background} /><Text style={styles.primaryText}>Registrar visita</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={isSaved ? `Quitar ${place.name} de Quiero ir` : `Guardar ${place.name} en Quiero ir`} style={styles.secondary} disabled={savedMutation.isPending} onPress={toggleSaved}><Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={18} color={isSaved ? colors.accent : colors.ink} /><Text style={styles.secondaryText}>{isSaved ? 'En mi radar' : 'Quiero ir'}</Text></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel={`Guardar ${place.name} en una lista`} style={styles.listLink} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="albums-outline" size={16} color={colors.accent} /><Text style={styles.listLinkText}>Guardar en una lista</Text></Pressable><View style={styles.section}><Text style={styles.sectionEyebrow}>QUÉ PEDIR AQUÍ</Text><Text style={styles.sectionTitle}>Cada taco cuenta.</Text>{place.tacos.map((taco) => <View key={taco.id} style={styles.taco}><View style={styles.tacoInfo}><Text style={styles.tacoName}>{taco.name}</Text><Text style={styles.tacoNote}>{taco.note}</Text></View><View style={styles.tacoScore}><RatingBadge rating={taco.rating} accent /><Text style={styles.price}>${taco.price}</Text></View></View>)}</View><View style={styles.profile}><Text style={styles.sectionEyebrow}>PERFIL DE SABOR</Text>{flavorLabels.map(({ key, label }) => <View key={key} style={styles.profileRow}><Text style={styles.profileLabel}>{label}</Text><View style={styles.bar}><View style={[styles.fill, { width: (place.flavorProfile[key] + '%') as any }]} /></View><Text style={styles.profileValue}>{place.flavorProfile[key]}</Text></View>)}</View><BranchReviewsSection reviews={reviewData?.reviews ?? []} isLoading={reviewsLoading} isError={reviewsError} onRetry={() => void refetchReviews()} /></View></ScrollView></>;
}

function BranchReviewsSection({ reviews, isLoading, isError, onRetry }: { reviews: BranchReview[]; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  return <View style={styles.reviewsSection}><View style={styles.reviewsHeader}><View><Text style={styles.sectionEyebrow}>LA COMUNIDAD</Text><Text style={styles.sectionTitle}>Reseñas de esta sucursal.</Text></View><Text style={styles.reviewsCount}>{reviews.length || '—'}</Text></View>{isLoading ? <Text style={styles.muted}>Cargando reseñas…</Text> : isError ? <View style={styles.reviewError}><Text style={styles.reviewErrorText}>No pudimos cargar las reseñas.</Text><Pressable style={styles.reviewRetry} onPress={onRetry}><Text style={styles.reviewRetryText}>Reintentar</Text></Pressable></View> : reviews.length ? reviews.map((review) => <View key={review.id} style={styles.reviewCard}>{review.photoUrl ? <Image source={{ uri: review.photoUrl }} style={styles.reviewPhoto} /> : null}<View style={styles.reviewBody}><View style={styles.reviewTop}><Pressable style={styles.reviewAuthor} onPress={() => router.push(`/user/${review.user.id}`)}><View style={styles.reviewAvatar}><Text style={styles.reviewAvatarText}>{review.user.displayName.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.reviewName}>{review.user.displayName}</Text></Pressable><RatingBadge rating={review.rating} accent /></View>{review.tacos ? <Text style={styles.reviewTacos}>{review.tacos}</Text> : null}{review.note ? <Text style={styles.reviewNote}>“{review.note}”</Text> : <Text style={styles.reviewNoteMuted}>Sin nota escrita; rating de la visita.</Text>}<Text style={styles.reviewDate}>{new Date(review.visitedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</Text></View></View>) : <Text style={styles.muted}>Aún no hay reseñas públicas de esta sucursal.</Text>}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 45 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.muted },
  notFound: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  notFoundTitle: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: spacing.md },
  notFoundCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320, marginTop: 7 },
  notFoundButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 11, marginTop: spacing.lg },
  notFoundButtonText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  cover: { height: 410, backgroundColor: colors.surfaceRaised },
  coverImage: { width: '100%', height: '100%' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,5,4,0.42)' },
  back: { position: 'absolute', top: 57, left: spacing.lg, width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.82)', alignItems: 'center', justifyContent: 'center' },
  save: { position: 'absolute', top: 57, right: spacing.lg, width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.82)', alignItems: 'center', justifyContent: 'center' },
  shareButton: { right: spacing.lg + 50 },
  coverCopy: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  pillText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  name: { color: colors.ink, fontSize: 37, fontWeight: '900', letterSpacing: -1.2 },
  location: { color: colors.ink, opacity: 0.86, fontSize: 12, fontWeight: '700', marginTop: 6 },
  body: { padding: spacing.lg },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  rating: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  ratingAccent: { color: colors.accent, fontSize: 24, fontWeight: '900' },
  ratingContext: { color: colors.muted, fontSize: 10, marginTop: -10, marginBottom: spacing.md },
  signalCard: { flexDirection: 'row', gap: spacing.xl, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  signalColumn: { flex: 1 },
  signalValue: { color: colors.accent, fontSize: 20, fontWeight: '900' },
  signalLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.9, marginTop: 3 },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: spacing.lg },
  parentLink: { marginTop: spacing.md, paddingVertical: 8 },
  parentLinkText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: spacing.lg },
  primary: { flex: 1, backgroundColor: colors.accent, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondary: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  secondaryText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  listLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  listLinkText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  section: { marginTop: spacing.xxl },
  sectionEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  sectionTitle: { color: colors.ink, fontSize: 25, fontWeight: '900', marginTop: 5, marginBottom: spacing.md },
  taco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.md },
  tacoInfo: { flex: 1, paddingRight: spacing.md },
  tacoName: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  tacoNote: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  tacoScore: { alignItems: 'flex-end', gap: 5 },
  price: { color: colors.warm, fontSize: 11, fontWeight: '800' },
  profile: { marginTop: spacing.xxl, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: spacing.md },
  profileLabel: { color: colors.muted, width: 72, fontSize: 11 },
  bar: { flex: 1, height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  profileValue: { color: colors.ink, width: 23, textAlign: 'right', fontSize: 11, fontWeight: '900' },
  reviewsSection: { marginTop: spacing.xxl },
  reviewsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  reviewsCount: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  reviewCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden', marginBottom: spacing.sm },
  reviewPhoto: { width: '100%', height: 170, backgroundColor: colors.surfaceRaised },
  reviewBody: { padding: spacing.md },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  reviewAuthor: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  reviewAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  reviewName: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  reviewTacos: { color: colors.warm, fontSize: 11, fontWeight: '800', marginTop: 10 },
  reviewNote: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  reviewNoteMuted: { color: colors.dim, fontSize: 11, fontStyle: 'italic', marginTop: 7 },
  reviewDate: { color: colors.dim, fontSize: 9, fontWeight: '800', marginTop: 10 },
  reviewError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
  reviewErrorText: { color: colors.muted, fontSize: 11, flex: 1 },
  reviewRetry: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  reviewRetryText: { color: colors.background, fontSize: 10, fontWeight: '900' },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }
});
