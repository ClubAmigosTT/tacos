import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deleteVisit, diary, trackEvent, updateVisit } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { parseOptionalPrice } from '@/lib/validation';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function VisitEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['diary', token], queryFn: () => diary(token!), enabled: Boolean(token && id) });
  const entry = data?.entries.find((item) => item.id === id);
  const [rating, setRating] = useState(5);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [inputError, setInputError] = useState('');
  const mutation = useMutation({
    mutationFn: (parsedPrice: number | null) => updateVisit(id, { rating, price: parsedPrice, note: note.trim() }, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['diary'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['discover'] }); void queryClient.invalidateQueries({ queryKey: ['place'] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); void queryClient.invalidateQueries({ queryKey: ['taste'] }); router.replace('/(tabs)/diary'); }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteVisit(id, token!),
    onSuccess: () => { void trackEvent('visit_deleted', {}, token); void queryClient.invalidateQueries({ queryKey: ['diary'] }); void queryClient.invalidateQueries({ queryKey: ['feed'] }); void queryClient.invalidateQueries({ queryKey: ['recommendations'] }); void queryClient.invalidateQueries({ queryKey: ['discover'] }); void queryClient.invalidateQueries({ queryKey: ['place'] }); void queryClient.invalidateQueries({ queryKey: ['taste'] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); router.replace('/(tabs)/diary'); }
  });

  useEffect(() => {
    if (!entry) return;
    setRating(Number(entry.rating));
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

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>TU HISTORIA</Text><Text style={styles.headerTitle}>Editar registro</Text></View><Ionicons name="create-outline" size={21} color={colors.accent} /></View><View style={styles.placeCard}><Text style={styles.place}>{entry.place_name}</Text><Text style={styles.tacos}>{entry.tacos || 'Visita registrada'}</Text><Text style={styles.date}>{new Date(entry.visited_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</Text></View><Text style={styles.label}>¿QUÉ TAL ESTUVO?</Text><View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={() => setRating(value)} style={[styles.rating, value <= rating && styles.ratingActive]}><Text style={[styles.ratingValue, value <= rating && styles.ratingValueActive]}>{value}</Text></Pressable>)}</View><Text style={styles.ratingHint}>{rating === 5 ? 'Lo defenderías contra tus amigos.' : rating >= 4 ? 'Volverías por otro.' : 'Buena información para tu futuro yo.'}</Text><Text style={styles.label}>PRECIO TOTAL</Text><View style={styles.contextRow}><TextInput value={price} onChangeText={(value) => { setPrice(value); setInputError(''); }} placeholder="Precio total (opcional)" placeholderTextColor={colors.dim} keyboardType="decimal-pad" style={styles.input} /><Text style={styles.currency}>MXN</Text></View><Text style={styles.label}>NOTA</Text><TextInput value={note} onChangeText={setNote} placeholder="Una nota para tu futuro yo" placeholderTextColor={colors.dim} multiline maxLength={500} style={[styles.input, styles.noteInput]} />{inputError ? <Text style={styles.error}>{inputError}</Text> : mutation.isError ? <Text style={styles.error}>No pudimos actualizar la visita. Revisa el precio e inténtalo de nuevo.</Text> : deleteMutation.isError ? <Text style={styles.error}>No pudimos eliminar la visita. Inténtalo de nuevo.</Text> : null}<Pressable style={[styles.primary, mutation.isPending && styles.disabled]} disabled={mutation.isPending} onPress={save}><Text style={styles.primaryText}>{mutation.isPending ? 'Guardando…' : 'Guardar cambios'}</Text><Ionicons name="checkmark" size={18} color={colors.background} /></Pressable><Pressable style={[styles.deleteButton, deleteMutation.isPending && styles.disabled]} disabled={deleteMutation.isPending} onPress={confirmDelete}><Ionicons name="trash-outline" size={16} color={colors.warm} /><Text style={styles.deleteText}>{deleteMutation.isPending ? 'Eliminando…' : 'Eliminar visita'}</Text></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 3 },
  placeCard: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl },
  place: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  tacos: { color: colors.warm, fontSize: 13, fontWeight: '800', marginTop: 5 },
  date: { color: colors.dim, fontSize: 11, marginTop: 12 },
  label: { color: colors.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.md, marginBottom: 8 },
  ratingRow: { flexDirection: 'row', gap: 8 },
  rating: { width: 49, height: 49, borderRadius: 25, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  ratingActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ratingValue: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  ratingValueActive: { color: colors.background },
  ratingHint: { color: colors.muted, fontSize: 12, marginTop: 10 },
  contextRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14 },
  currency: { color: colors.muted, fontSize: 11, fontWeight: '800', marginLeft: 9 },
  noteInput: { minHeight: 115, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  primary: { backgroundColor: colors.accent, minHeight: 53, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: spacing.xl },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  deleteButton: { minHeight: 46, borderWidth: 1, borderColor: 'rgba(221,126,84,0.42)', borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: spacing.md },
  deleteText: { color: colors.warm, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  secondaryText: { color: colors.accent, fontSize: 12, fontWeight: '900' }
});
