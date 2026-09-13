import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { createVisit, discover, getPlace, isDemoMode, trackEvent, uploadImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type CategoryRatings } from '@/data/fixtures';
import { places } from '@/lib/localCatalog';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { StarRating } from '@/components/StarRating';
import { parseOptionalPrice } from '@/lib/validation';

const ratingCategories: Array<{ key: keyof CategoryRatings; label: string }> = [
  { key: 'tortilla', label: 'Tortilla' },
  { key: 'service', label: 'Servicio' },
  { key: 'price', label: 'Precio' },
  { key: 'meat', label: 'Carne' },
  { key: 'salsas', label: 'Salsas' }
];

export default function RegisterScreen() {
  const { token, loading } = useAuth();
  const queryClient = useQueryClient();
  const { placeId: initialPlaceId } = useLocalSearchParams<{ placeId?: string }>();
  const demoMode = isDemoMode();
  const fallbackPlace = places.find((item) => item.id === initialPlaceId) ?? places[0];
  const remoteInitialPlace = Boolean(initialPlaceId && (!demoMode || !places.some((item) => item.id === initialPlaceId)));
  const { data: fetchedInitialPlace, isLoading: initialPlaceLoading, isError: initialPlaceError, refetch: refetchInitialPlace } = useQuery({
    queryKey: ['place', 'register', initialPlaceId, token],
    queryFn: () => getPlace(initialPlaceId!, token),
    enabled: remoteInitialPlace
  });
  const initialPlace = fetchedInitialPlace ?? fallbackPlace;
  const initialTacoId = initialPlace.tacos[0]?.id;
  const [placeId, setPlaceId] = useState(initialPlace.id);
  const [tacoIds, setTacoIds] = useState<string[]>(initialTacoId ? [initialTacoId] : []);
  const [tacoRatings, setTacoRatings] = useState<Record<string, number>>(initialTacoId ? { [initialTacoId]: 5 } : {});
  const [rating, setRating] = useState(0);
  const [categoryRatings, setCategoryRatings] = useState<CategoryRatings>({});
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }>();
  const [photoSuggestion, setPhotoSuggestion] = useState<{ place: (typeof places)[number]; tacoId?: string }>();
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { data: nearbyPlaces, isLoading: nearbyPlacesLoading, isError: nearbyPlacesError, refetch: refetchNearbyPlaces } = useQuery({ queryKey: ['discover', 'register', coordinates?.latitude, coordinates?.longitude, token], queryFn: () => discover({ lat: coordinates?.latitude, lng: coordinates?.longitude, limit: 3 }, token) });
  // Anonymous review can use the local catalog, but an authenticated visit
  // must wait for the real nearby result instead of selecting a demo branch.
  const visibleNearbyPlaces = token ? (nearbyPlaces ?? []) : (nearbyPlaces ?? (demoMode ? places : []));
  // A deep link from a place detail is an explicit user choice. Keep that
  // branch in the selector even when the nearest-three query does not include
  // it, so location ranking never changes the visit behind the user's back.
  const hasExplicitPlace = Boolean(initialPlaceId && initialPlace.id === initialPlaceId);
  const availablePlaces = hasExplicitPlace && !visibleNearbyPlaces.some((item) => item.id === initialPlace.id)
    ? [initialPlace, ...visibleNearbyPlaces]
    : visibleNearbyPlaces;
  const place = availablePlaces.find((item) => item.id === placeId) ?? availablePlaces[0] ?? fallbackPlace;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) return;
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) setCoordinates({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      } catch { /* Location is optional; the full catalog remains available. */ }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (availablePlaces.some((item) => item.id === placeId) || !availablePlaces[0]) return;
    const first = availablePlaces[0];
    setPlaceId(first.id);
    setTacoIds(first.tacos[0] ? [first.tacos[0].id] : []);
    setTacoRatings(first.tacos[0] ? { [first.tacos[0].id]: 5 } : {});
    setCategoryRatings({});
  }, [availablePlaces, placeId]);

  useEffect(() => {
    if (!fetchedInitialPlace) return;
    setPlaceId(fetchedInitialPlace.id);
    const firstTaco = fetchedInitialPlace.tacos[0];
    setTacoIds(firstTaco ? [firstTaco.id] : []);
    setTacoRatings(firstTaco ? { [firstTaco.id]: 5 } : {});
    setCategoryRatings({});
  }, [fetchedInitialPlace?.id]);

  if (loading) return <View style={styles.authRequired}><Text style={styles.successText}>Cargando tu sesión…</Text></View>;
  if (!token) return <View style={styles.authRequired}><View style={styles.successIcon}><Ionicons name="person" size={26} color={colors.background} /></View><Text style={styles.successTitle}>Tu diario necesita una cuenta</Text><Text style={styles.successText}>Crea tu identidad para guardar esta visita y verla después en tu historial.</Text><Pressable accessibilityRole="button" accessibilityLabel="Entrar o crear cuenta" style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/register', placeId: initialPlaceId ?? placeId } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Cancelar registro" onPress={() => router.back()}><Text style={styles.cancelText}>Ahora no</Text></Pressable></View>;
  if (remoteInitialPlace && initialPlaceLoading) return <View style={styles.authRequired}><Text style={styles.successText}>Buscando la sucursal…</Text></View>;
  if (remoteInitialPlace && (initialPlaceError || !fetchedInitialPlace)) return <AsyncErrorState title="No encontramos esa sucursal" detail="El enlace puede haber caducado o la conexión no estar disponible. Inténtalo de nuevo o vuelve al mapa." onAction={() => void refetchInitialPlace()} />;
  if (token && nearbyPlacesError && !hasExplicitPlace) return <View style={styles.authRequired}><AsyncErrorState title="No pudimos encontrar lugares cercanos" detail="No mostramos sucursales demo mientras tu sesión está activa. Revisa la conexión para registrar una visita real." onAction={() => void refetchNearbyPlaces()} /></View>;
  if (token && nearbyPlacesLoading && !hasExplicitPlace) return <View style={styles.authRequired}><Text style={styles.successText}>Buscando lugares cercanos…</Text></View>;
  if (token && !hasExplicitPlace && !nearbyPlacesLoading && !nearbyPlacesError && !visibleNearbyPlaces.length) return <View style={styles.authRequired}><Ionicons name="location-outline" size={28} color={colors.tortilla} /><Text style={styles.successTitle}>No hay sucursales disponibles</Text><Text style={styles.successText}>El catálogo no tiene lugares cercanos para registrar todavía. Explora el mapa o vuelve a intentarlo más tarde.</Text><Pressable style={styles.primary} onPress={() => router.replace('/(tabs)/map')}><Text style={styles.primaryText}>Volver al mapa</Text></Pressable></View>;

  function selectPlace(id: string) {
    setPlaceId(id);
    setTacoIds([]);
    setTacoRatings({});
    setCategoryRatings({});
    setPhotoSuggestion(undefined);
  }

  function acceptPhotoSuggestion() {
    if (!photoSuggestion) return;
    const suggestion = photoSuggestion;
    if (suggestion.place.id !== placeId) selectPlace(suggestion.place.id);
    if (suggestion.tacoId) {
      setTacoIds([suggestion.tacoId]);
      setTacoRatings({ [suggestion.tacoId]: 5 });
    }
    setPhotoSuggestion(undefined);
  }

  function toggleTaco(id: string) {
    setTacoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setTacoRatings((current) => {
      const next = { ...current };
      if (Object.prototype.hasOwnProperty.call(next, id)) delete next[id];
      else next[id] = 5;
      return next;
    });
  }

  async function choosePhoto(source: 'camera' | 'library') {
    try {
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8, base64: true });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset?.base64) { if (!result.canceled) setError('No pudimos leer esa foto. Prueba con otra imagen.'); return; }
      const contentType = asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
      setPhoto({ uri: asset.uri, base64: asset.base64, contentType });
      // Keep the explicit branch selected by a deep link, but base the camera
      // hint on the actual nearest-place query rather than on the selector's
      // first item (which may be the preserved explicit branch).
      const suggestedPlace = source === 'camera' && coordinates ? visibleNearbyPlaces[0] ?? availablePlaces[0] : undefined;
      const suggestedTaco = suggestedPlace?.tacos.reduce((best, taco) => taco.rating > (best?.rating ?? 0) ? taco : best, suggestedPlace.tacos[0]);
      setPhotoSuggestion(suggestedPlace ? { place: suggestedPlace, tacoId: suggestedTaco?.id } : undefined);
      setError('');
    } catch { setError('No pudimos abrir la cámara o galería.'); }
  }

  async function save() {
    if (!token) return;
    const parsedPrice = parseOptionalPrice(price);
    if (parsedPrice === undefined) {
      setError('El precio debe ser un número entre $0 y $100,000 MXN (máximo dos decimales).');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let photoUrl: string | undefined;
      let photoUploadFailed = false;
      if (photo) {
        try {
          const uploaded = await uploadImage({ base64: photo.base64, contentType: photo.contentType }, token);
          photoUrl = uploaded.url;
        } catch {
          // Media is best-effort: a storage outage must not discard the
          // visit and its ratings when the photo is optional.
          photoUploadFailed = true;
        }
      }
      await createVisit({ placeId, tacoIds, rating, categoryRatings, tacoRatings, price: parsedPrice ?? undefined, note: note.trim() || undefined, photoUrl, latitude: coordinates?.latitude, longitude: coordinates?.longitude }, token);
      if (photoUploadFailed) Alert.alert('Visita guardada', 'La foto no pudo guardarse, pero la visita sí quedó registrada sin imagen.');
      void trackEvent('visit_saved', { place_id: placeId }, token);
      void queryClient.invalidateQueries({ queryKey: ['diary'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['place', placeId] });
      void queryClient.invalidateQueries({ queryKey: ['branch-reviews', placeId] });
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
      void queryClient.invalidateQueries({ queryKey: ['taste'] });
      setSaved(true);
    } catch {
      setError('No pudimos guardar la visita. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (saved) return <View style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.background} /></View><Text style={styles.successTitle}>Visita registrada</Text><Text style={styles.successText}>Tu diario acaba de ganar una nueva historia.</Text><Pressable accessibilityRole="button" accessibilityLabel="Volver al mapa" style={styles.primary} onPress={() => router.replace('/(tabs)/map')}><Text style={styles.primaryText}>Volver al mapa</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar registro" onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.textPrimary} /></Pressable><View style={styles.headerTitle}><Text style={styles.kicker}>NUEVA ENTRADA</Text><Text style={styles.title}>Registrar visita</Text></View><View style={{ width: 25 }} /></View>

    <Text style={styles.question}>¿Dónde comiste?</Text>
    {coordinates ? <Text style={styles.nearbyHint}>Lugares más cercanos a tu ubicación</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>{availablePlaces.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${item.name}, ${item.neighborhood}`} accessibilityState={{ selected: item.id === placeId }} onPress={() => selectPlace(item.id)} style={[styles.placePill, item.id === placeId && styles.placePillActive]}><Text style={[styles.placePillText, item.id === placeId && styles.placePillTextActive]}>{item.name}</Text><Text style={[styles.placePillMeta, item.id === placeId && styles.placePillTextActive]}>{item.neighborhood}</Text></Pressable>)}</ScrollView>

    <Text style={styles.question}>¿Qué comiste?</Text>
    {place.tacos.length ? <View style={styles.tacos}>{place.tacos.map((taco) => { const selected = tacoIds.includes(taco.id); const tacoRating = tacoRatings[taco.id] ?? 0; return <Pressable key={taco.id} accessibilityRole="checkbox" accessibilityLabel={`${taco.name}, ${selected ? 'seleccionado' : 'no seleccionado'}`} accessibilityState={{ checked: selected }} onPress={() => toggleTaco(taco.id)} style={[styles.taco, selected && styles.tacoActive]}><View style={styles.tacoCopy}><Text style={[styles.tacoName, selected && styles.tacoNameActive]}>{taco.name}</Text><Text style={[styles.tacoNote, selected && styles.tacoNameActive]}>{taco.note}</Text>{selected ? <View style={styles.tacoRatingRow}><Text style={styles.tacoRatingLabel}>Taco</Text>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${taco.name}: ${value} de 5`} accessibilityState={{ selected: value === tacoRating }} onPress={(event) => { event.stopPropagation(); setTacoRatings((current) => ({ ...current, [taco.id]: value })); }} style={[styles.tacoRating, value <= tacoRating && styles.tacoRatingActive]}><Text style={[styles.tacoRatingValue, value <= tacoRating && styles.tacoRatingValueActive]}>{value}</Text></Pressable>)}</View> : null}</View><View style={[styles.checkbox, selected && styles.checkboxActive]}>{selected ? <Ionicons name="checkmark" color={colors.background} size={15} /> : null}</View></Pressable>; })}</View> : <View style={styles.emptyMenu}><Ionicons name="restaurant-outline" size={21} color={colors.tortilla} /><Text style={styles.emptyMenuTitle}>Menú pendiente</Text><Text style={styles.emptyMenuText}>Puedes calificar la taquería aunque todavía no tenga tacos registrados.</Text></View>}

    <View style={styles.mainRatingCard}><Text style={styles.ratingEyebrow}>CALIFICACIÓN PRINCIPAL</Text><Text style={styles.ratingTitle}>¿Qué tal estuvo la taquería?</Text><StarRating value={rating} onChange={setRating} size={34} accessibilityLabel="Calificación de la taquería" /><Text style={styles.ratingHint}>{rating === 0 ? '0 = sin calificar · toca el lado izquierdo o derecho de una estrella para usar medias estrellas.' : rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text></View>

    <View style={styles.categoryCard}><Text style={styles.categoryEyebrow}>DETALLES DE LA VISITA</Text><Text style={styles.categoryTitle}>Califica cada aspecto</Text><Text style={styles.categoryHint}>Usa medias estrellas si quieres. Puedes dejar en 0 lo que no quieras puntuar.</Text>{ratingCategories.map(({ key, label }) => <View key={key} style={styles.categoryRow}><Text style={styles.categoryLabel}>{label}</Text><StarRating value={categoryRatings[key] ?? 0} onChange={(value) => setCategoryRatings((current) => ({ ...current, [key]: value }))} size={21} accessibilityLabel={`Calificación de ${label}`} /></View>)}</View>

    <View style={styles.contextRow}><TextInput accessibilityLabel="Precio total opcional" value={price} onChangeText={setPrice} placeholder="Precio total (opcional)" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" style={[styles.contextInput, styles.priceInput]} /><Text style={styles.currency}>MXN</Text></View>
    <TextInput accessibilityLabel="Nota opcional" value={note} onChangeText={setNote} placeholder="Una nota para tu futuro yo (opcional)" placeholderTextColor={colors.textTertiary} multiline maxLength={500} style={[styles.contextInput, styles.noteInput]} />

    <View style={styles.photoBlock}><View style={styles.photoHeader}><Text style={styles.photoLabel}>FOTO DEL TACO <Text style={styles.optional}>OPCIONAL</Text></Text>{photo ? <Pressable accessibilityRole="button" accessibilityLabel="Quitar foto" onPress={() => { setPhoto(undefined); setPhotoSuggestion(undefined); }}><Text style={styles.removePhoto}>Quitar</Text></Pressable> : null}</View>{photo ? <View style={styles.photoPreviewWrap}><Image source={{ uri: photo.uri }} style={styles.photoPreview} />{photoSuggestion ? <View style={styles.photoSuggestion}><Ionicons name="sparkles-outline" size={16} color={colors.tortilla} /><View style={styles.photoSuggestionCopy}><Text style={styles.photoSuggestionTitle}>¿Fue {photoSuggestion.place.name}{photoSuggestion.tacoId ? ` · ${photoSuggestion.place.tacos.find((taco) => taco.id === photoSuggestion.tacoId)?.name ?? 'taco'}` : ''}?</Text><Text style={styles.photoSuggestionText}>Sugerencia por tu ubicación</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Usar ${photoSuggestion.place.name}`} style={styles.photoSuggestionAction} onPress={acceptPhotoSuggestion}><Text style={styles.photoSuggestionActionText}>Usar</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Descartar sugerencia" onPress={() => setPhotoSuggestion(undefined)}><Text style={styles.photoSuggestionDismiss}>No</Text></Pressable></View> : null}</View> : <View style={styles.photoButtons}><Pressable accessibilityRole="button" accessibilityLabel="Tomar foto con la cámara" style={styles.photoButton} onPress={() => void choosePhoto('camera')}><Ionicons name="camera-outline" size={18} color={colors.tortilla} /><Text style={styles.photoButtonText}>Cámara</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Elegir foto de la galería" style={styles.photoButton} onPress={() => void choosePhoto('library')}><Ionicons name="images-outline" size={18} color={colors.tortilla} /><Text style={styles.photoButtonText}>Galería</Text></Pressable></View>}</View>

    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Guardar visita en mi diario" style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={save}><Text style={styles.primaryText}>{saving ? (photo ? 'Subiendo foto…' : 'Guardando…') : 'Guardar en mi diario'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 45 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  headerTitle: { alignItems: 'center' },
  kicker: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.6 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 20, fontWeight: typography.weight.semibold, marginTop: 3 },
  question: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 22, fontWeight: typography.weight.semibold, letterSpacing: -0.5, marginBottom: spacing.md, marginTop: spacing.md },
  nearbyHint: { color: colors.cilantroLight, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, marginTop: -8, marginBottom: 8 },
  placeRow: { gap: 8, paddingBottom: 5 },
  placePill: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.md, minWidth: 140 },
  placePillActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  placePillText: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  placePillMeta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: 4 },
  placePillTextActive: { color: colors.meatDark },
  tacos: { gap: 8 },
  taco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md },
  tacoActive: { borderColor: colors.tortilla, backgroundColor: colors.surfaceElevated },
  tacoCopy: { flex: 1, paddingRight: spacing.sm },
  tacoName: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 15, fontWeight: typography.weight.semibold },
  tacoNameActive: { color: colors.tortilla },
  tacoNote: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 4, maxWidth: 260 },
  checkbox: { width: 25, height: 25, borderRadius: 8, borderWidth: 1, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  tacoRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 },
  tacoRatingLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium, marginRight: 2 },
  tacoRating: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tacoRatingActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  tacoRatingValue: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium },
  tacoRatingValueActive: { color: colors.meatDark },
  emptyMenu: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.lg, alignItems: 'center' },
  emptyMenuTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold, marginTop: 8 },
  emptyMenuText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  mainRatingCard: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  ratingEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.2 },
  ratingTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 21, fontWeight: typography.weight.semibold, marginTop: 5, marginBottom: 14 },
  ratingHint: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: 9 },
  categoryCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  categoryEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.2 },
  categoryTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 18, fontWeight: typography.weight.semibold, marginTop: 5 },
  categoryHint: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: 5, marginBottom: 4 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderTopWidth: 1, borderTopColor: colors.border },
  categoryLabel: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 13, fontWeight: typography.weight.medium, flex: 1 },
  contextRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  contextInput: { color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, paddingHorizontal: 13, paddingVertical: 12 },
  priceInput: { flex: 1 },
  currency: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, marginLeft: 9 },
  noteInput: { minHeight: 76, textAlignVertical: 'top', marginTop: 10 },
  photoBlock: { marginTop: 22 },
  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  photoLabel: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1.1 },
  optional: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium, letterSpacing: 0.5 },
  removePhoto: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  photoButtons: { flexDirection: 'row', gap: 8 },
  photoButton: { flex: 1, minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  photoButtonText: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium },
  photoPreview: { width: '100%', height: 180, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  photoPreviewWrap: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surface },
  photoSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  photoSuggestionCopy: { flex: 1 },
  photoSuggestionTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  photoSuggestionText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: 2 },
  photoSuggestionAction: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  photoSuggestionActionText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  photoSuggestionDismiss: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium, paddingHorizontal: 4 },
  error: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, lineHeight: 17, marginTop: 16 },
  primary: { marginTop: 30, backgroundColor: colors.tortilla, borderRadius: radii.md, minHeight: 54, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, ...shadows.card },
  primaryText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  disabled: { opacity: 0.35 },
  success: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  authRequired: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.cilantroLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 28, fontWeight: typography.weight.bold },
  successText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 14, textAlign: 'center', marginTop: 8 },
  cancelText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium, marginTop: spacing.lg }
});
