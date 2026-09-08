import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { createVisit, discover, uploadImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { places } from '@/data/fixtures';
import { colors, radii, spacing } from '@/theme';

export default function RegisterScreen() {
  const { token } = useAuth();
  const [placeId, setPlaceId] = useState(places[0].id);
  const [tacoIds, setTacoIds] = useState<string[]>([places[0].tacos[0].id]);
  const [tacoRatings, setTacoRatings] = useState<Record<string, number>>({ [places[0].tacos[0].id]: 5 });
  const [rating, setRating] = useState(5);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { data: availablePlaces = places } = useQuery({ queryKey: ['discover', 'register'], queryFn: () => discover(), placeholderData: places });
  const place = availablePlaces.find((item) => item.id === placeId) ?? availablePlaces[0] ?? places[0];

  useEffect(() => {
    if (availablePlaces.some((item) => item.id === placeId) || !availablePlaces[0]) return;
    const first = availablePlaces[0];
    setPlaceId(first.id);
    setTacoIds(first.tacos[0] ? [first.tacos[0].id] : []);
    setTacoRatings(first.tacos[0] ? { [first.tacos[0].id]: rating } : {});
  }, [availablePlaces, placeId, rating]);

  if (!token) return <View style={styles.authRequired}><View style={styles.successIcon}><Ionicons name="person" size={26} color={colors.background} /></View><Text style={styles.successTitle}>Tu diario necesita una cuenta</Text><Text style={styles.successText}>Crea tu identidad para guardar esta visita y verla después en tu historial.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/register' } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable><Pressable onPress={() => router.back()}><Text style={styles.cancelText}>Ahora no</Text></Pressable></View>;

  function selectPlace(id: string) {
    setPlaceId(id);
    setTacoIds([]);
    setTacoRatings({});
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
      setError('');
    } catch { setError('No pudimos abrir la cámara o galería.'); }
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const uploaded = photo ? await uploadImage({ base64: photo.base64, contentType: photo.contentType }, token) : undefined;
      await createVisit({ placeId, tacoIds, rating, tacoRatings, price: price ? Number(price) : undefined, note: note.trim() || undefined, photoUrl: uploaded?.url }, token);
      setSaved(true);
    } catch {
      setError(photo ? 'No pudimos subir la foto. Revisa la conexión o quítala para guardar la visita sin imagen.' : 'No pudimos guardar la visita. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (saved) return <View style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.background} /></View><Text style={styles.successTitle}>Visita registrada</Text><Text style={styles.successText}>Tu diario acaba de ganar una nueva historia.</Text><Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Volver al mapa</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.ink} /></Pressable><View style={styles.headerTitle}><Text style={styles.kicker}>NUEVA ENTRADA</Text><Text style={styles.title}>Registrar visita</Text></View><View style={{ width: 25 }} /></View><Text style={styles.question}>¿Dónde comiste?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>{availablePlaces.map((item) => <Pressable key={item.id} onPress={() => selectPlace(item.id)} style={[styles.placePill, item.id === placeId && styles.placePillActive]}><Text style={[styles.placePillText, item.id === placeId && styles.placePillTextActive]}>{item.name}</Text><Text style={[styles.placePillMeta, item.id === placeId && styles.placePillTextActive]}>{item.neighborhood}</Text></Pressable>)}</ScrollView><Text style={styles.question}>¿Qué comiste?</Text><View style={styles.tacos}>{place.tacos.map((taco) => { const selected = tacoIds.includes(taco.id); return <Pressable key={taco.id} onPress={() => toggleTaco(taco.id)} style={[styles.taco, selected && styles.tacoActive]}><View style={styles.tacoCopy}><Text style={[styles.tacoName, selected && styles.tacoNameActive]}>{taco.name}</Text><Text style={[styles.tacoNote, selected && styles.tacoNameActive]}>{taco.note}</Text>{selected ? <View style={styles.tacoRatingRow}><Text style={styles.tacoRatingLabel}>Taco</Text>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={(event) => { event.stopPropagation(); setTacoRatings((current) => ({ ...current, [taco.id]: value })); }} style={[styles.tacoRating, value <= (tacoRatings[taco.id] ?? rating) && styles.tacoRatingActive]}><Text style={[styles.tacoRatingValue, value <= (tacoRatings[taco.id] ?? rating) && styles.tacoRatingValueActive]}>{value}</Text></Pressable>)}</View> : null}</View><View style={[styles.checkbox, selected && styles.checkboxActive]}>{selected ? <Ionicons name="checkmark" color={colors.background} size={15} /> : null}</View></Pressable>; })}</View><Text style={styles.question}>¿Qué tal estuvo?</Text><View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={() => setRating(value)} style={[styles.rating, value <= rating && styles.ratingActive]}><Text style={[styles.ratingValue, value <= rating && styles.ratingValueActive]}>{value}</Text></Pressable>)}</View><Text style={styles.ratingHint}>{rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text><View style={styles.contextRow}><TextInput value={price} onChangeText={setPrice} placeholder="Precio total (opcional)" placeholderTextColor={colors.dim} keyboardType="decimal-pad" style={[styles.contextInput, styles.priceInput]} /><Text style={styles.currency}>MXN</Text></View><TextInput value={note} onChangeText={setNote} placeholder="Una nota para tu futuro yo (opcional)" placeholderTextColor={colors.dim} multiline maxLength={500} style={[styles.contextInput, styles.noteInput]} /><View style={styles.photoBlock}><View style={styles.photoHeader}><Text style={styles.photoLabel}>FOTO DEL TACO <Text style={styles.optional}>OPCIONAL</Text></Text>{photo ? <Pressable onPress={() => setPhoto(undefined)}><Text style={styles.removePhoto}>Quitar</Text></Pressable> : null}</View>{photo ? <Image source={{ uri: photo.uri }} style={styles.photoPreview} /> : <View style={styles.photoButtons}><Pressable style={styles.photoButton} onPress={() => void choosePhoto('camera')}><Ionicons name="camera-outline" size={18} color={colors.accent} /><Text style={styles.photoButtonText}>Cámara</Text></Pressable><Pressable style={styles.photoButton} onPress={() => void choosePhoto('library')}><Ionicons name="images-outline" size={18} color={colors.accent} /><Text style={styles.photoButtonText}>Galería</Text></Pressable></View>}</View>{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable style={[styles.primary, (tacoIds.length === 0 || saving) && styles.disabled]} disabled={tacoIds.length === 0 || saving} onPress={save}><Text style={styles.primaryText}>{saving ? (photo ? 'Subiendo foto…' : 'Guardando…') : 'Guardar en mi diario'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 45 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  headerTitle: { alignItems: 'center' },
  kicker: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 },
  question: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: spacing.md, marginTop: spacing.md },
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
