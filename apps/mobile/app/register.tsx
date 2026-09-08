import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createVisit } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { places } from '@/data/fixtures';
import { colors, radii, spacing } from '@/theme';

export default function RegisterScreen() {
  const { token } = useAuth();
  const [placeId, setPlaceId] = useState(places[0].id);
  const [tacoIds, setTacoIds] = useState<string[]>([places[0].tacos[0].id]);
  const [rating, setRating] = useState(5);
  const [saved, setSaved] = useState(false);
  const place = places.find((item) => item.id === placeId) ?? places[0];

  if (!token) return <View style={styles.authRequired}><View style={styles.successIcon}><Ionicons name="person" size={26} color={colors.background} /></View><Text style={styles.successTitle}>Tu diario necesita una cuenta</Text><Text style={styles.successText}>Crea tu identidad para guardar esta visita y verla después en tu historial.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/register' } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable><Pressable onPress={() => router.back()}><Text style={styles.cancelText}>Ahora no</Text></Pressable></View>;

  function selectPlace(id: string) {
    setPlaceId(id);
    setTacoIds([]);
  }

  function toggleTaco(id: string) {
    setTacoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function save() {
    if (!token) return;
    try { await createVisit({ placeId, tacoIds, rating }, token); } catch { /* Demo mode remains usable without the API. */ }
    setSaved(true);
  }

  if (saved) return <View style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.background} /></View><Text style={styles.successTitle}>Visita registrada</Text><Text style={styles.successText}>Tu diario acaba de ganar una nueva historia.</Text><Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Volver al mapa</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.ink} /></Pressable><View style={styles.headerTitle}><Text style={styles.kicker}>NUEVA ENTRADA</Text><Text style={styles.title}>Registrar visita</Text></View><View style={{ width: 25 }} /></View><Text style={styles.question}>¿Dónde comiste?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>{places.map((item) => <Pressable key={item.id} onPress={() => selectPlace(item.id)} style={[styles.placePill, item.id === placeId && styles.placePillActive]}><Text style={[styles.placePillText, item.id === placeId && styles.placePillTextActive]}>{item.name}</Text><Text style={[styles.placePillMeta, item.id === placeId && styles.placePillTextActive]}>{item.neighborhood}</Text></Pressable>)}</ScrollView><Text style={styles.question}>¿Qué comiste?</Text><View style={styles.tacos}>{place.tacos.map((taco) => <Pressable key={taco.id} onPress={() => toggleTaco(taco.id)} style={[styles.taco, tacoIds.includes(taco.id) && styles.tacoActive]}><View><Text style={[styles.tacoName, tacoIds.includes(taco.id) && styles.tacoNameActive]}>{taco.name}</Text><Text style={[styles.tacoNote, tacoIds.includes(taco.id) && styles.tacoNameActive]}>{taco.note}</Text></View><View style={[styles.checkbox, tacoIds.includes(taco.id) && styles.checkboxActive]}>{tacoIds.includes(taco.id) ? <Ionicons name="checkmark" color={colors.background} size={15} /> : null}</View></Pressable>)}</View><Text style={styles.question}>¿Qué tal estuvo?</Text><View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={() => setRating(value)} style={[styles.rating, value <= rating && styles.ratingActive]}><Text style={[styles.ratingValue, value <= rating && styles.ratingValueActive]}>{value}</Text></Pressable>)}</View><Text style={styles.ratingHint}>{rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text><Pressable style={[styles.primary, tacoIds.length === 0 && styles.disabled]} disabled={tacoIds.length === 0} onPress={save}><Text style={styles.primaryText}>Guardar en mi diario</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable></ScrollView>;
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
  tacoName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  tacoNameActive: { color: colors.accent },
  tacoNote: { color: colors.muted, fontSize: 11, marginTop: 4, maxWidth: 260 },
  checkbox: { width: 25, height: 25, borderRadius: 8, borderWidth: 1, borderColor: colors.dim, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ratingRow: { flexDirection: 'row', gap: 8 },
  rating: { width: 49, height: 49, borderRadius: 25, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  ratingActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ratingValue: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  ratingValueActive: { color: colors.background },
  ratingHint: { color: colors.muted, fontSize: 12, marginTop: 10 },
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
