import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deleteVisit, diary, trackEvent, updateVisit } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { parseOptionalPrice } from '@/lib/validation';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { StarRating } from '@/components/StarRating';
import type { CategoryRatings } from '@/data/fixtures';

const ratingCategories: Array<{ key: keyof CategoryRatings; label: string }> = [
  { key: 'tortilla', label: 'Tortilla' },
  { key: 'service', label: 'Servicio' },
  { key: 'price', label: 'Precio' },
  { key: 'meat', label: 'Carne' },
  { key: 'salsas', label: 'Salsas' }
];

export default function VisitEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['diary', token], queryFn: () => diary(token!), enabled: Boolean(token && id && !authLoading) });
  const entry = data?.entries.find((item) => item.id === id);
  const [rating, setRating] = useState(0);
  const [categoryRatings, setCategoryRatings] = useState<CategoryRatings>({});
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [inputError, setInputError] = useState('');
  const mutation = useMutation({
    mutationFn: (parsedPrice: number | null) => updateVisit(id, { rating, categoryRatings, price: parsedPrice, note: note.trim() }, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['diary'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['discover'] }); void queryClient.invalidateQueries({ queryKey: ['place'] }); void queryClient.invalidateQueries({ queryKey: ['branch-reviews'] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); void queryClient.invalidateQueries({ queryKey: ['taste'] }); router.replace('/(tabs)/diary'); }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteVisit(id, token!),
    onSuccess: () => { void trackEvent('visit_deleted', {}, token); void queryClient.invalidateQueries({ queryKey: ['diary'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['discover'] }); void queryClient.invalidateQueries({ queryKey: ['place'] }); void queryClient.invalidateQueries({ queryKey: ['taste'] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); router.replace('/(tabs)/diary'); }
  });

  useEffect(() => {
    if (!entry) return;
    setRating(Number(entry.rating));
    setCategoryRatings(entry.category_ratings ?? {});
    setPrice(entry.price == null ? '' : String(entry.price));
    setNote(entry.note ?? '');
  }, [entry]);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu registro…</Text></View>;
  if (!token) return <View style={styles.center}><Text style={styles.title}>Entra para editar tu diario</Text><Text style={styles.muted}>Tus registros sólo se pueden cambiar desde tu cuenta.</Text><Pressable style={styles.secondary} onPress={() => router.push('/auth')}><Text style={styles.secondaryText}>Entrar</Text></Pressable></View>;
  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando registro…</Text></View>;
  if (isError) return <AsyncErrorState title="No pudimos cargar tu registro" detail="Tu diario sigue intacto. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  if (!entry) return <View style={styles.center}><Text style={styles.title}>Registro no disponible</Text><Text style={styles.muted}>Puede que haya sido ocultado o eliminado.</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Volver</Text></Pressable></View>;

  function confirmDelete() {
    Alert.alert('¿Eliminar visita?', 'Se quitará de tu diario y dejará de alimentar tus recomendaciones.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => deleteMutation.mutate() }
    ]);
  }

  function save() {
    const parsedPrice = parseOptionalPrice(price);
    if (parsedPrice === undefined) {
      setInputError('El precio debe ser un número entre $0 y $100,000 MXN (máximo dos decimales).');
      return;
    }
    setInputError('');
    mutation.mutate(parsedPrice);
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View><Text style={styles.eyebrow}>TU HISTORIA</Text><Text style={styles.headerTitle}>Editar registro</Text></View><Ionicons name="create-outline" size={21} color={colors.tortilla} /></View>
    <View style={styles.placeCard}><Text style={styles.place}>{entry.place_name}</Text><Text style={styles.tacos}>{entry.tacos || 'Visita registrada'}</Text><Text style={styles.date}>{new Date(entry.visited_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</Text></View>

    <View style={styles.mainRatingCard}><Text style={styles.ratingEyebrow}>CALIFICACIÓN PRINCIPAL</Text><Text style={styles.ratingTitle}>¿Qué tal estuvo la taquería?</Text><StarRating value={rating} onChange={setRating} size={34} accessibilityLabel="Calificación de la taquería" /><Text style={styles.ratingHint}>{rating === 0 ? '0 = sin calificar · se permiten medias estrellas.' : rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text></View>

    <View style={styles.categoryCard}><Text style={styles.categoryEyebrow}>DETALLES DE LA VISITA</Text><Text style={styles.categoryTitle}>Califica cada aspecto</Text><Text style={styles.categoryHint}>Puedes dejar en 0 lo que no quieras puntuar.</Text>{ratingCategories.map(({ key, label }) => <View key={key} style={styles.categoryRow}><Text style={styles.categoryLabel}>{label}</Text><StarRating value={categoryRatings[key] ?? 0} onChange={(value) => setCategoryRatings((current) => ({ ...current, [key]: value }))} size={21} accessibilityLabel={`Calificación de ${label}`} /></View>)}</View>

    <Text style={styles.label}>PRECIO TOTAL</Text><View style={styles.contextRow}><TextInput value={price} onChangeText={(value) => { setPrice(value); setInputError(''); }} placeholder="Precio total (opcional)" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" style={styles.input} /><Text style={styles.currency}>MXN</Text></View>
    <Text style={styles.label}>NOTA</Text><TextInput value={note} onChangeText={setNote} placeholder="Una nota para tu futuro yo" placeholderTextColor={colors.textTertiary} multiline maxLength={500} style={[styles.input, styles.noteInput]} />
    {inputError ? <Text style={styles.error}>{inputError}</Text> : mutation.isError ? <Text style={styles.error}>No pudimos actualizar la visita. Revisa el precio e inténtalo de nuevo.</Text> : deleteMutation.isError ? <Text style={styles.error}>No pudimos eliminar la visita. Inténtalo de nuevo.</Text> : null}
    <Pressable style={[styles.primary, mutation.isPending && styles.disabled]} disabled={mutation.isPending} onPress={save}><Text style={styles.primaryText}>{mutation.isPending ? 'Guardando…' : 'Guardar cambios'}</Text><Ionicons name="checkmark" size={18} color={colors.background} /></Pressable>
    <Pressable style={[styles.deleteButton, deleteMutation.isPending && styles.disabled]} disabled={deleteMutation.isPending} onPress={confirmDelete}><Ionicons name="trash-outline" size={16} color={colors.salsa} /><Text style={styles.deleteText}>{deleteMutation.isPending ? 'Eliminando…' : 'Eliminar visita'}</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  headerTitle: { color: colors.textPrimary, fontSize: 27, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 3 },
  placeCard: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  place: { color: colors.textPrimary, fontSize: 20, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  tacos: { color: colors.salsa, fontSize: 13, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold, marginTop: 5 },
  date: { color: colors.textTertiary, fontSize: 11, fontFamily: typography.fontFamily.regular, marginTop: 12 },
  mainRatingCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  ratingEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 9, fontWeight: typography.weight.semibold, letterSpacing: 1.2 },
  ratingTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 21, fontWeight: typography.weight.semibold, marginTop: 5, marginBottom: 14 },
  ratingHint: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: 9 },
  categoryCard: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  categoryEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 9, fontWeight: typography.weight.semibold, letterSpacing: 1.2 },
  categoryTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 18, fontWeight: typography.weight.semibold, marginTop: 5 },
  categoryHint: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: 5, marginBottom: 4 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderTopWidth: 1, borderTopColor: colors.border },
  categoryLabel: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 13, fontWeight: typography.weight.medium, flex: 1 },
  label: { color: colors.textTertiary, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.2, marginTop: spacing.md, marginBottom: 8 },
  contextRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14 },
  currency: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold, marginLeft: 9 },
  noteInput: { minHeight: 115, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 17, marginTop: spacing.md },
  primary: { backgroundColor: colors.tortilla, minHeight: 53, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: spacing.xl },
  primaryText: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  deleteButton: { minHeight: 46, borderWidth: 1, borderColor: colors.salsaBorder, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: spacing.md },
  deleteText: { color: colors.salsa, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  disabled: { opacity: 0.4 },
  title: { color: colors.textPrimary, fontSize: 25, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, textAlign: 'center' },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  secondaryText: { color: colors.tortilla, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }
});
