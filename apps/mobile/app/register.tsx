import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { createVisit, discover, trackEvent, uploadImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { places } from '@/data/fixtures';
import { colors, radii, spacing } from '@/theme';

export default function RegisterScreen() {
  const { token, loading } = useAuth();
  const queryClient = useQueryClient();
  const { placeId: initialPlaceId } = useLocalSearchParams<{ placeId?: string }>();
  const initialPlace = places.find((item) => item.id === initialPlaceId) ?? places[0];
  const initialTacoId = initialPlace.tacos[0]?.id;
  const [placeId, setPlaceId] = useState(initialPlace.id);
  const [tacoIds, setTacoIds] = useState<string[]>(initialTacoId ? [initialTacoId] : []);
  const [tacoRatings, setTacoRatings] = useState<Record<string, number>>(initialTacoId ? { [initialTacoId]: 5 } : {});
  const [rating, setRating] = useState(5);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }>();
  const [photoSuggestion, setPhotoSuggestion] = useState<(typeof places)[number]>();
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { data: availablePlaces = places } = useQuery({ queryKey: ['discover', 'register', coordinates?.latitude, coordinates?.longitude], queryFn: () => discover({ lat: coordinates?.latitude, lng: coordinates?.longitude, limit: 3 }), placeholderData: places });
  const place = availablePlaces.find((item) => item.id === placeId) ?? availablePlaces[0] ?? places[0];

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
    setTacoRatings(first.tacos[0] ? { [first.tacos[0].id]: rating } : {});
  }, [availablePlaces, placeId, rating]);

  if (loading) return <View style={styles.authRequired}><Text style={styles.successText}>Cargando tu sesión…</Text></View>;
  if (!token) return <View style={styles.authRequired}><View style={styles.successIcon}><Ionicons name="person" size={26} color={colors.background} /></View><Text style={styles.successTitle}>Tu diario necesita una cuenta</Text><Text style={styles.successText}>Crea tu identidad para guardar esta visita y verla después en tu historial.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/register', placeId } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable><Pressable onPress={() => router.back()}><Text style={styles.cancelText}>Ahora no</Text></Pressable></View>;

  function selectPlace(id: string) {
    setPlaceId(id);
    setTacoIds([]);
    setTacoRatings({});
    setPhotoSuggestion(undefined);
  }

  function acceptPhotoSuggestion() {
    if (!photoSuggestion) return;
    if (photoSuggestion.id !== placeId) selectPlace(photoSuggestion.id);
    else setPhotoSuggestion(undefined);
  }

  function toggleTaco(id: string) {
    setTacoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setTacoRatings((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = rating;
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
      setPhotoSuggestion(source === 'camera' && coordinates ? availablePlaces[0] : undefined);
      setError('');
    } catch { setError('No pudimos abrir la cámara o galería.'); }
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const uploaded = photo ? await uploadImage({ base64: photo.base64, contentType: photo.contentType }, token) : undefined;
      await createVisit({ placeId, tacoIds, rating, tacoRatings, price: price ? Number(price) : undefined, note: note.trim() || undefined, photoUrl: uploaded?.url, latitude: coordinates?.latitude, longitude: coordinates?.longitude }, token);
      void trackEvent('visit_saved', { place_id: placeId }, token);
      void queryClient.invalidateQueries({ queryKey: ['diary'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['place', placeId] });
      setSaved(true);
    } catch {
      setError(photo ? 'No pudimos subir la foto. Revisa la conexión o quítala para guardar la visita sin imagen.' : 'No pudimos guardar la visita. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (saved) return <View style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.background} /></View><Text style={styles.successTitle}>Visita registrada</Text><Text style={styles.successText}>Tu diario acaba de ganar una nueva historia.</Text><Pressable style={styles.primary} onPress={() => router.replace('/(tabs)/map')}><Text style={styles.primaryText}>Volver al mapa</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.ink} /></Pressable><View style={styles.headerTitle}><Text style={styles.kicker}>NUEVA ENTRADA</Text><Text style={styles.title}>Registrar visita</Text></View><View style={{ width: 25 }} /></View><Text style={styles.question}>¿Dónde comiste?</Text>{coordinates ? <Text style={styles.nearbyHint}>Lugares más cercanos a tu ubicación</Text> : null}<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>{availablePlaces.map((item) => <Pressable key={item.id} onPress={() => selectPlace(item.id)} style={[styles.placePill, item.id === placeId && styles.placePillActive]}><Text style={[styles.placePillText, item.id === placeId && styles.placePillTextActive]}>{item.name}</Text><Text style={[styles.placePillMeta, item.id === placeId && styles.placePillTextActive]}>{item.neighborhood}</Text></Pressable>)}</ScrollView><Text style={styles.question}>¿Qué comiste?</Text><View style={styles.tacos}>{place.tacos.map((taco) => { const selected = tacoIds.includes(taco.id); return <Pressable key={taco.id} onPress={() => toggleTaco(taco.id)} style={[styles.taco, selected && styles.tacoActive]}><View style={styles.tacoCopy}><Text style={[styles.tacoName, selected && styles.tacoNameActive]}>{taco.name}</Text><Text style={[styles.tacoNote, selected && styles.tacoNameActive]}>{taco.note}</Text>{selected ? <View style={styles.tacoRatingRow}><Text style={styles.tacoRatingLabel}>Taco</Text>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={(event) => { event.stopPropagation(); setTacoRatings((current) => ({ ...current, [taco.id]: value })); }} style={[styles.tacoRating, value <= (tacoRatings[taco.id] ?? rating) && styles.tacoRatingActive]}><Text style={[styles.tacoRatingValue, value <= (tacoRatings[taco.id] ?? rating) && styles.tacoRatingValueActive]}>{value}</Text></Pressable>)}</View> : null}</View><View style={[styles.checkbox, selected && styles.checkboxActive]}>{selected ? <Ionicons name="checkmark" color={colors.background} size={15} /> : null}</View></Pressable>; })}</View><Text style={styles.question}>¿Qué tal estuvo?</Text><View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={() => setRating(value)} style={[styles.rating, value <= rating && styles.ratingActive]}><Text style={[styles.ratingValue, value <= rating && styles.ratingValueActive]}>{value}</Text></Pressable>)}</View><Text style={styles.ratingHint}>{rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text><View style={styles.contextRow}><TextInput value={price} onChangeText={setPrice} placeholder="Precio total (opcional)" placeholderTextColor={colors.dim} keyboardType="decimal-pad" style={[styles.contextInput, styles.priceInput]} /><Text style={styles.currency}>MXN</Text></View><TextInput value={note} onChangeText={setNote} placeholder="Una nota para tu futuro yo (opcional)" placeholderTextColor={colors.dim} multiline maxLength={500} style={[styles.contextInput, styles.noteInput]} /><View style={styles.photoBlock}><View style={styles.photoHeader}><Text style={styles.photoLabel}>FOTO DEL TACO <Text style={styles.optional}>OPCIONAL</Text></Text>{photo ? <Pressable onPress={() => { setPhoto(undefined); setPhotoSuggestion(undefined); }}><Text style={styles.removePhoto}>Quitar</Text></Pressable> : null}</View>{photo ? <View style={styles.photoPreviewWrap}><Image source={{ uri: photo.uri }} style={styles.photoPreview} />{photoSuggestion ? <View style={styles.photoSuggestion}><Ionicons name="sparkles-outline" size={16} color={colors.accent} /><View style={styles.photoSuggestionCopy}><Text style={styles.photoSuggestionTitle}>¿Fue {photoSuggestion.name}?</Text><Text style={styles.photoSuggestionText}>Sugerencia por tu ubicación</Text></View><Pressable style={styles.photoSuggestionAction} onPress={acceptPhotoSuggestion}><Text style={styles.photoSuggestionActionText}>Usar</Text></Pressable><Pressable onPress={() => setPhotoSuggestion(undefined)}><Text style={styles.photoSuggestionDismiss}>No</Text></Pressable></View> : null}</View> : <View style={styles.photoButtons}><Pressable style={styles.photoButton} onPress={() => void choosePhoto('camera')}><Ionicons name="camera-outline" size={18} color={colors.accent} /><Text style={styles.photoButtonText}>Cámara</Text></Pressable><Pressable style={styles.photoButton} onPress={() => void choosePhoto('library')}><Ionicons name="images-outline" size={18} color={colors.accent} /><Text style={styles.photoButtonText}>Galería</Text></Pressable></View>}</View>{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable style={[styles.primary, (tacoIds.length === 0 || saving) && styles.disabled]} disabled={tacoIds.length === 0 || saving} onPress={save}><Text style={styles.primaryText}>{saving ? (photo ? 'Subiendo foto…' : 'Guardando…') : 'Guardar en mi diario'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 45 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  headerTitle: { alignItems: 'center' },
  kicker: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 },
  question: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: spacing.md, marginTop: spacing.md },
  nearbyHint: { color: colors.accent, fontSize: 11, fontWeight: '800', marginTop: -8, marginBottom: 8 },
  placeRow: { gap: 8, paddingBottom: 5 },
  placePill: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md, minWidth: 140 },
  placePillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  placePillText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  placePillMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  placePillTextActive: { color: colors.background },
  tacos: { gap: 8 },
  taco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  tacoActive: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  tacoCopy: { flex: 1, paddingRight: spacing.sm },
  tacoName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  tacoNameActive: { color: colors.accent },
  tacoNote: { color: colors.muted, fontSize: 11, marginTop: 4, maxWidth: 260 },
  checkbox: { width: 25, height: 25, borderRadius: 8, borderWidth: 1, borderColor: colors.dim, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tacoRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 },
  tacoRatingLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', marginRight: 2 },
  tacoRating: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tacoRatingActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tacoRatingValue: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  tacoRatingValueActive: { color: colors.background },
  ratingRow: { flexDirection: 'row', gap: 8 },
  rating: { width: 49, height: 49, borderRadius: 25, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  ratingActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ratingValue: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  ratingValueActive: { color: colors.background },
  ratingHint: { color: colors.muted, fontSize: 12, marginTop: 10 },
  contextRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  contextInput: { color: colors.ink, fontSize: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 13, paddingVertical: 12 },
  priceInput: { flex: 1 },
  currency: { color: colors.muted, fontSize: 11, fontWeight: '800', marginLeft: 9 },
  noteInput: { minHeight: 76, textAlignVertical: 'top', marginTop: 10 },
  photoBlock: { marginTop: 22 },
  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  photoLabel: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  optional: { color: colors.dim, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  removePhoto: { color: colors.warm, fontSize: 11, fontWeight: '800' },
  photoButtons: { flexDirection: 'row', gap: 8 },
  photoButton: { flex: 1, minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  photoButtonText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  photoPreview: { width: '100%', height: 180, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  photoPreviewWrap: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surface },
  photoSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  photoSuggestionCopy: { flex: 1 },
  photoSuggestionTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  photoSuggestionText: { color: colors.muted, fontSize: 10, marginTop: 2 },
  photoSuggestionAction: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  photoSuggestionActionText: { color: colors.background, fontSize: 10, fontWeight: '900' },
  photoSuggestionDismiss: { color: colors.muted, fontSize: 10, fontWeight: '900', paddingHorizontal: 4 },
  error: { color: '#F08A8A', fontSize: 12, lineHeight: 17, marginTop: 16 },
  primary: { marginTop: 30, backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 54, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.35 },
  success: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  authRequired: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successTitle: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  successText: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 8 },
  cancelText: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.lg },
});
