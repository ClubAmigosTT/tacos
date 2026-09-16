import { useEffect } from 'react';
import { Share } from 'react-native';
import * as Linking from 'expo-linking';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { branchReviews, getPlace, googleBranchPhotos, hasRealPlaceMedia, savePlace, savedPlaces, trackEvent, unsavePlace, type BranchReview } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { StarRating } from '@/components/StarRating';
import { isOpenNow } from '@/lib/hours';
import type { Place } from '@/data/fixtures';
import { CatalogImage } from '@/components/CatalogImage';

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => { if (id) void trackEvent('place_open', { place_id: id }, token); }, [id, token]);
  const { data: place, isLoading, isError } = useQuery({ queryKey: ['place', id, token], queryFn: () => getPlace(id, token), enabled: Boolean(id && !authLoading) });
  const hasCatalogPhotos = Boolean(place && hasRealPlaceMedia(place));
  const { data: googlePhotoData, isLoading: googlePhotosLoading } = useQuery({ queryKey: ['google-photos', id], queryFn: () => googleBranchPhotos(id), enabled: Boolean(id && place && !hasCatalogPhotos), staleTime: 15 * 60_000, gcTime: 30 * 60_000, retry: false, refetchOnMount: false });
  const { data: reviewData, isLoading: reviewsLoading, isError: reviewsError, refetch: refetchReviews } = useQuery({ queryKey: ['branch-reviews', id], queryFn: () => branchReviews(id), enabled: Boolean(id), staleTime: 60_000 });
  const { data: savedData } = useQuery({ queryKey: ['saved-places', token], queryFn: () => savedPlaces(token!), enabled: Boolean(token && !authLoading) });
  const savedMutation = useMutation({
    mutationFn: () => savedData?.placeIds.includes(place!.id) ? unsavePlace(place!.id, token!) : savePlace(place!.id, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['saved-places', token] }); }
  });
  if (authLoading || isLoading) return <View style={styles.loading}><Text style={styles.loadingText}>{authLoading ? 'Preparando la ficha…' : 'Cargando lugar…'}</Text></View>;
  if (isError || !place) return <View style={styles.notFound}><Ionicons name="location-outline" size={28} color={colors.tortilla} /><Text style={styles.notFoundTitle}>Taquería no disponible</Text><Text style={styles.notFoundCopy}>El enlace puede haber cambiado o la sucursal todavía no está disponible.</Text><Pressable style={styles.notFoundButton} onPress={() => router.replace('/(tabs)/map')}><Text style={styles.notFoundButtonText}>Volver al mapa</Text></Pressable></View>;
  const currentPlace = place;
  const averagePrice = place.tacos.length ? Math.round(place.tacos.reduce((sum, taco) => sum + taco.price, 0) / place.tacos.length) : undefined;
  const priceLabel = place.priceMin != null || place.priceMax != null
    ? place.priceMin != null && place.priceMax != null && place.priceMin !== place.priceMax ? `$${place.priceMin}–$${place.priceMax}` : `$${place.priceMin ?? place.priceMax}`
    : averagePrice ? `$${averagePrice}` : '—';
  const ratingDisplay = place.rating > 0 ? place.rating.toFixed(2) : '—';
  const matchDisplay = place.match != null ? `${place.match}%` : '—';
  const googlePhotos = googlePhotoData?.photos ?? [];
  const displayedPhotos = [...(place.photos ?? []), ...googlePhotos];
  const coverImage = place.image || displayedPhotos[0]?.url || '';
  const openNow = isOpenNow(place.openUntil, new Date(), place.weeklyHours, place.hoursKnown);
  const isSaved = Boolean(id && savedData?.placeIds.includes(id));
  function toggleSaved() {
    if (!token) { router.push({ pathname: '/auth', params: { returnTo: `/place/${id}` } }); return; }
    savedMutation.mutate();
  }
  async function sharePlace() {
    try { await Share.share({ message: `${currentPlace.name} · ${ratingDisplay} en Tacos\n${Linking.createURL(`/place/${currentPlace.id}`)}` }); } catch { /* Compartir es opcional en plataformas sin hoja nativa. */ }
  }
  function openPhotoSource(photo: (typeof displayedPhotos)[number]) {
    const sourceUrl = photo.googleMapsUri ?? photo.sourceUrl;
    if (sourceUrl) void Linking.openURL(sourceUrl);
  }
  return <><Stack.Screen options={{ headerShown: false }} /><ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.cover}><CatalogImage uri={coverImage} accessibilityLabel={`Imagen de ${place.name}`} style={styles.coverImage} /><View style={styles.coverShade} />{place.catalogStatus === 'needs_review' ? <View style={styles.reviewBadge}><Text style={styles.reviewBadgeText}>Información por verificar</Text></View> : null}{place.imageIsIllustrative ? <View style={[styles.illustrativeBadge, place.catalogStatus === 'needs_review' && styles.illustrativeBadgeBelow]}><Text style={styles.illustrativeBadgeText}>Imagen ilustrativa</Text></View> : null}<Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={23} color={colors.textPrimary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Compartir ficha de ${place.name}`} style={[styles.save, styles.shareButton]} onPress={() => void sharePlace()}><Ionicons name="share-outline" size={19} color={colors.textPrimary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Guardar ${place.name} en una lista`} style={styles.save} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="bookmark-outline" size={20} color={colors.textPrimary} /></Pressable><View style={styles.coverCopy}><View style={styles.pill}><Text style={styles.pillText}>{place.style.toUpperCase()}</Text></View><Text style={styles.name}>{place.name}</Text><Text style={styles.location}>{place.neighborhood} · {openNow ? 'Abierto ahora' : `Cierra a las ${place.openUntil}`}</Text></View></View><View style={styles.body}><View style={styles.stats}><View><Text style={styles.rating}>{ratingDisplay}</Text><Text style={styles.statLabel}>GLOBAL</Text></View><View><Text style={styles.ratingAccent}>{matchDisplay}</Text><Text style={styles.statLabel}>PARA TI</Text></View><View><Text style={styles.rating}>{priceLabel}</Text><Text style={styles.statLabel}>PRECIO</Text></View><View><Text style={styles.rating}>{place.distance}</Text><Text style={styles.statLabel}>DISTANCIA</Text></View></View><Text style={styles.ratingContext}>{place.reviewCount ? `${place.reviewCount} reseñas de la comunidad` : place.rating > 0 ? 'Calificación de catálogo; aún sin reseñas públicas' : 'Aún no hay calificaciones suficientes'}</Text>{place.tasteMatch != null || place.socialMatch != null ? <View accessibilityLabel="Señales de afinidad" style={styles.signalCard}><View style={styles.signalColumn}><Text style={styles.signalValue}>{place.tasteMatch ?? place.match ?? '—'}{place.tasteMatch != null || place.match != null ? '%' : ''}</Text><Text style={styles.signalLabel}>GUSTOS SIMILARES</Text></View>{place.socialMatch != null ? <View style={styles.signalColumn}><Text style={styles.signalValue}>{place.socialMatch}%</Text><Text style={styles.signalLabel}>TU CÍRCULO</Text></View> : null}</View> : null}<Text style={styles.description}>{place.description}</Text><PlaceInfo place={place} />{googlePhotosLoading ? <Text style={styles.photoHint}>Buscando una foto temporal…</Text> : null}{displayedPhotos.length ? <View style={styles.photoSection}><View style={styles.photoSectionHeader}><Text style={styles.photoSectionTitle}>FOTOS DEL LUGAR</Text>{googlePhotos.length ? <Text style={styles.photoSectionSource}>Temporal · Google Maps</Text> : null}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>{displayedPhotos.map((photo, index) => <Pressable key={`${photo.url}-${index}`} style={styles.photoItem} accessibilityRole="button" accessibilityLabel={photo.source === 'google_maps' ? 'Abrir foto en Google Maps' : 'Abrir foto'} onPress={() => openPhotoSource(photo)}><CatalogImage uri={photo.url} fallbackLabel="Foto no disponible" accessibilityLabel={`Foto de ${place.name}`} style={styles.catalogPhoto} /><Text style={styles.photoAttribution} numberOfLines={3}>{photo.attribution}</Text>{photo.source === 'google_maps' ? <Text style={styles.photoSourceLink}>Ver en Google Maps ↗</Text> : null}</Pressable>)}</ScrollView></View> : null}{place.taqueriaId ? <Pressable style={styles.parentLink} onPress={() => router.push(`/taqueria/${place.taqueriaId}`)}><Text style={styles.parentLinkText}>Ver {place.taqueriaName ?? 'taquería'} y sus sucursales →</Text></Pressable> : null}<View style={styles.actionRow}><Pressable accessibilityRole="button" accessibilityLabel="Registrar visita" style={styles.primary} onPress={() => router.push({ pathname: '/register', params: { placeId: place.id } })}><Ionicons name="add" size={18} color={colors.background} /><Text style={styles.primaryText}>Registrar visita</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={isSaved ? `Quitar ${place.name} de Quiero ir` : `Guardar ${place.name} en Quiero ir`} style={styles.secondary} disabled={savedMutation.isPending} onPress={toggleSaved}><Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={18} color={isSaved ? colors.tortilla : colors.textPrimary} /><Text style={styles.secondaryText}>{savedMutation.isPending ? 'Actualizando…' : isSaved ? 'En mi radar' : 'Quiero ir'}</Text></Pressable></View>{savedMutation.isError ? <Text accessibilityLiveRegion="polite" style={styles.mutationError}>No pudimos actualizar tu radar. Inténtalo de nuevo.</Text> : null}<View style={styles.catalogActions}><Pressable accessibilityRole="button" style={styles.catalogAction} onPress={() => router.push({ pathname: '/catalog-proposal', params: { branchId: place.id, kind: 'correction' } })}><Ionicons name="create-outline" size={16} color={colors.tortilla} /><Text style={styles.catalogActionText}>Corregir información</Text></Pressable><Pressable accessibilityRole="button" style={styles.catalogAction} onPress={() => router.push({ pathname: '/catalog-proposal', params: { branchId: place.id, kind: 'menu_item' } })}><Ionicons name="restaurant-outline" size={16} color={colors.tortilla} /><Text style={styles.catalogActionText}>Proponer un taco</Text></Pressable></View><Pressable accessibilityRole="button" style={styles.photoAction} onPress={() => router.push({ pathname: '/photo-upload', params: { branchId: place.id, placeName: place.name } })}><Ionicons name="camera-outline" size={16} color={colors.tortilla} /><Text style={styles.catalogActionText}>Agregar foto</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Guardar ${place.name} en una lista`} style={styles.listLink} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="albums-outline" size={16} color={colors.tortilla} /><Text style={styles.listLinkText}>Guardar en una lista</Text></Pressable><View style={styles.section}><Text style={styles.sectionEyebrow}>QUÉ PEDIR AQUÍ</Text><Text style={styles.sectionTitle}>Cada taco cuenta.</Text>{place.tacos.length ? place.tacos.map((taco) => <View key={taco.id} style={styles.taco}><View style={styles.tacoInfo}><Text style={styles.tacoName}>{taco.name}</Text><Text style={styles.tacoNote}>{taco.note}</Text></View><View style={styles.tacoScore}><RatingBadge rating={taco.rating} accent /><Text style={styles.price}>${taco.price}</Text></View></View>) : <Text style={styles.muted}>Menú pendiente de completar por la comunidad.</Text>}</View><BranchReviewsSection reviews={reviewData?.reviews ?? []} isLoading={reviewsLoading} isError={reviewsError} onRetry={() => void refetchReviews()} /></View></ScrollView></>;
}

const scheduleDays = [
  ['mon', 'Lun'], ['tue', 'Mar'], ['wed', 'Mié'], ['thu', 'Jue'], ['fri', 'Vie'], ['sat', 'Sáb'], ['sun', 'Dom']
] as const;

const ratingCategories: Array<{ key: keyof NonNullable<Place['ratingBreakdown']>; label: string }> = [
  { key: 'tortilla', label: 'Tortilla' },
  { key: 'service', label: 'Servicio' },
  { key: 'price', label: 'Precio' },
  { key: 'meat', label: 'Carne' },
  { key: 'salsas', label: 'Salsas' }
];

function PlaceInfo({ place }: { place: Place }) {
  function openMaps() {
    const { latitude, longitude } = place.coordinates;
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`);
  }
  function callPlace() {
    if (place.phone) void Linking.openURL(`tel:${place.phone.replace(/[^+\d]/g, '')}`);
  }
  const sourceAttribution = (place.source?.attribution ?? place.source?.name ?? '').replace(/^Fuente:\s*/i, '').trim();
  return <View style={styles.infoBlock}>
    <CommunityRatingBreakdown place={place} />
    {place.address ? <Pressable accessibilityRole="button" accessibilityLabel="Abrir dirección en mapas" style={styles.infoRow} onPress={openMaps}><Ionicons name="navigate-outline" size={17} color={colors.tortilla} /><Text style={styles.infoText}>{place.address}</Text><Ionicons name="open-outline" size={15} color={colors.textTertiary} /></Pressable> : null}
    {place.phone ? <Pressable accessibilityRole="button" accessibilityLabel="Llamar a la taquería" style={styles.infoRow} onPress={callPlace}><Ionicons name="call-outline" size={17} color={colors.tortilla} /><Text style={styles.infoText}>{place.phone}</Text><Ionicons name="call-outline" size={15} color={colors.textTertiary} /></Pressable> : null}
    <View style={styles.hoursBlock}><View style={styles.hoursHeading}><Ionicons name="time-outline" size={17} color={colors.tortilla} /><Text style={styles.infoHeading}>HORARIO SEMANAL</Text></View>{place.weeklyHours ? scheduleDays.map(([key, label]) => <View key={key} style={styles.hoursRow}><Text style={styles.dayLabel}>{label}</Text><Text style={styles.hoursText}>{place.weeklyHours?.[key]?.length ? place.weeklyHours[key].map((interval) => `${interval.open}–${interval.close}`).join(', ') : 'Cerrado'}</Text></View>) : <Text style={styles.unverified}>{place.hoursKnown === false ? 'Horario no disponible en la fuente. Puedes proponer una actualización.' : `Horario semanal aún no verificado. Referencia: cierre a las ${place.openUntil}.`}</Text>}</View>
    {sourceAttribution ? <Text style={styles.sourceText}>Fuente: {sourceAttribution}{place.source?.updatedAt ? ` · actualizado ${new Date(place.source.updatedAt).toLocaleDateString('es-MX')}` : ''}</Text> : null}
  </View>;
}

function CommunityRatingBreakdown({ place }: { place: Place }) {
  const breakdown = place.ratingBreakdown;
  const ratedCategories = breakdown ? ratingCategories.filter(({ key }) => (breakdown[key] ?? 0) > 0) : [];
  if (!ratedCategories.length) return null;
  return <View style={styles.breakdownCard} accessibilityLabel="Calificaciones de la comunidad por categoría"><View style={styles.breakdownHeader}><View><Text style={styles.breakdownEyebrow}>DETALLES DE LA COMUNIDAD</Text><Text style={styles.breakdownTitle}>Calidad en cada bocado</Text></View><Text style={styles.breakdownCount}>{place.reviewCount ?? ratedCategories.length} reseñas</Text></View>{ratedCategories.map(({ key, label }) => <View style={styles.breakdownRow} key={key}><Text style={styles.breakdownLabel}>{label}</Text><StarRating value={breakdown?.[key] ?? 0} readOnly size={18} accessibilityLabel={`Promedio de ${label}`} /></View>)}</View>;
}

function BranchReviewsSection({ reviews, isLoading, isError, onRetry }: { reviews: BranchReview[]; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  return <View style={styles.reviewsSection}><View style={styles.reviewsHeader}><View><Text style={styles.sectionEyebrow}>LA COMUNIDAD</Text><Text style={styles.sectionTitle}>Reseñas de esta sucursal.</Text></View><Text style={styles.reviewsCount}>{reviews.length || '—'}</Text></View>{isLoading ? <Text style={styles.muted}>Cargando reseñas…</Text> : isError ? <View style={styles.reviewError}><Text style={styles.reviewErrorText}>No pudimos cargar las reseñas.</Text><Pressable style={styles.reviewRetry} onPress={onRetry}><Text style={styles.reviewRetryText}>Reintentar</Text></Pressable></View> : reviews.length ? reviews.map((review) => <View key={review.id} style={styles.reviewCard}>{review.photoUrl ? <Image source={{ uri: review.photoUrl }} style={styles.reviewPhoto} /> : null}<View style={styles.reviewBody}><View style={styles.reviewTop}><Pressable style={styles.reviewAuthor} onPress={() => router.push(`/user/${review.user.id}`)}><View style={styles.reviewAvatar}><Text style={styles.reviewAvatarText}>{review.user.displayName.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.reviewName}>{review.user.displayName}</Text></Pressable><RatingBadge rating={review.rating} accent /></View>{review.tacos ? <Text style={styles.reviewTacos}>{review.tacos}</Text> : null}{review.note ? <Text style={styles.reviewNote}>“{review.note}”</Text> : <Text style={styles.reviewNoteMuted}>Sin nota escrita; rating de la visita.</Text>}<Text style={styles.reviewDate}>{new Date(review.visitedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</Text></View></View>) : <Text style={styles.muted}>Aún no hay reseñas públicas de esta sucursal.</Text>}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 45 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular },
  notFound: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  notFoundTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 25, fontWeight: typography.weight.semibold, textAlign: 'center', marginTop: spacing.md },
  notFoundCopy: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320, marginTop: 7 },
  notFoundButton: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 11, marginTop: spacing.lg },
  notFoundButtonText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  cover: { height: 410, backgroundColor: colors.surfaceRaised },
  coverImage: { width: '100%', height: '100%' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  reviewBadge: { position: 'absolute', top: 114, left: spacing.lg, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  reviewBadgeText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  illustrativeBadge: { position: 'absolute', top: 114, left: spacing.lg, backgroundColor: colors.overlayStrong, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  illustrativeBadgeBelow: { top: 150 },
  illustrativeBadgeText: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 10 },
  back: { position: 'absolute', top: 57, left: spacing.lg, width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.overlayStrong, alignItems: 'center', justifyContent: 'center', ...shadows.floating },
  save: { position: 'absolute', top: 57, right: spacing.lg, width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.overlayStrong, alignItems: 'center', justifyContent: 'center', ...shadows.floating },
  shareButton: { right: spacing.lg + 50 },
  coverCopy: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  pillText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  name: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 37, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.display },
  location: { color: colors.textPrimary, opacity: 0.86, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium, marginTop: 6 },
  body: { padding: spacing.lg },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  rating: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 24, fontWeight: typography.weight.bold },
  ratingAccent: { color: colors.cilantroLight, fontFamily: typography.fontFamily.bold, fontSize: 24, fontWeight: typography.weight.bold },
  ratingContext: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: -10, marginBottom: spacing.md },
  signalCard: { flexDirection: 'row', gap: spacing.xl, backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.sm, ...shadows.card },
  signalColumn: { flex: 1 },
  signalValue: { color: colors.tortilla, fontFamily: typography.fontFamily.bold, fontSize: 20, fontWeight: typography.weight.bold },
  signalLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 0.9, marginTop: 3 },
  statLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1, marginTop: 4 },
  description: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 15, lineHeight: 22, marginTop: spacing.lg },
  infoBlock: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...shadows.card },
  breakdownCard: { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
  breakdownHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  breakdownEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  breakdownTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 15, fontWeight: typography.weight.semibold, marginTop: 3 },
  breakdownCount: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium, marginTop: 2 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 43, borderTopWidth: 1, borderTopColor: colors.border },
  breakdownLabel: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium, flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 34, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoText: { color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 12, flex: 1, lineHeight: 18 },
  hoursBlock: { paddingTop: spacing.sm },
  hoursHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  infoHeading: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dayLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, width: 32 },
  hoursText: { color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 11, flex: 1 },
  unverified: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, lineHeight: 17 },
  sourceText: { color: colors.textTertiary, fontFamily: typography.fontFamily.regular, fontSize: 10, lineHeight: 15, marginTop: spacing.sm },
  photoHint: { color: colors.textTertiary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: spacing.md },
  photoSection: { marginTop: spacing.md },
  photoSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  photoSectionTitle: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  photoSectionSource: { color: colors.textTertiary, fontFamily: typography.fontFamily.regular, fontSize: 9 },
  photoStrip: { gap: spacing.sm, paddingTop: spacing.md },
  photoItem: { width: 132 },
  catalogPhoto: { width: 132, height: 96, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  photoAttribution: { color: colors.textTertiary, fontFamily: typography.fontFamily.regular, fontSize: 9, lineHeight: 12, marginTop: 4 },
  photoSourceLink: { color: colors.tortilla, fontFamily: typography.fontFamily.medium, fontSize: 9, marginTop: 3 },
  parentLink: { marginTop: spacing.md, paddingVertical: 8 },
  parentLinkText: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: spacing.lg },
  primary: { flex: 1, backgroundColor: colors.tortilla, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  primaryText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  secondary: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  secondaryText: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  mutationError: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  catalogActions: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  catalogAction: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  catalogActionText: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold, textAlign: 'center' },
  photoAction: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8, marginTop: spacing.sm },
  listLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  listLinkText: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  section: { marginTop: spacing.xxl },
  sectionEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose },
  sectionTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 25, fontWeight: typography.weight.semibold, marginTop: 5, marginBottom: spacing.md },
  taco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.md },
  tacoInfo: { flex: 1, paddingRight: spacing.md },
  tacoName: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 16, fontWeight: typography.weight.semibold },
  tacoNote: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
  tacoScore: { alignItems: 'flex-end', gap: 5 },
  price: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  reviewsSection: { marginTop: spacing.xxl },
  reviewsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  reviewsCount: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.sm, ...shadows.card },
  reviewPhoto: { width: '100%', height: 170, backgroundColor: colors.surfaceRaised },
  reviewBody: { padding: spacing.md },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  reviewAuthor: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  reviewAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  reviewName: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  reviewTacos: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, marginTop: 10 },
  reviewNote: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: 7 },
  reviewNoteMuted: { color: colors.textTertiary, fontFamily: typography.fontFamily.regular, fontSize: 11, fontStyle: 'italic', marginTop: 7 },
  reviewDate: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium, marginTop: 10 },
  reviewError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...shadows.card },
  reviewErrorText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, flex: 1 },
  reviewRetry: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  reviewRetryText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  muted: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 18 }
});
