import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, listDetails, updateList } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function ListEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data: list, isLoading, isError, error, refetch } = useQuery({ queryKey: ['list', id, token], queryFn: () => listDetails(id, token), enabled: Boolean(id && token && !authLoading) });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const mutation = useMutation({
    mutationFn: () => updateList(id, { title, description, visibility }, token!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['list', id] }); void queryClient.invalidateQueries({ queryKey: ['lists'] }); router.replace(`/list/${id}`); }
  });
  useEffect(() => { if (!list) return; setTitle(list.title); setDescription(list.description); setVisibility(list.visibility ?? 'public'); }, [list]);
  if (authLoading || isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando lista…</Text></View>;
  if (isError && !(error instanceof ApiError && error.status === 404)) return <AsyncErrorState title="No pudimos cargar la lista" detail="La curaduría no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  if (!list || !token || list.owner.id !== user?.id) return <View style={styles.center}><Text style={styles.title}>No puedes editar esta lista</Text><Text style={styles.muted}>Sólo el propietario puede cambiar su curaduría.</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Volver</Text></Pressable></View>;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>CURADURÍA PERSONAL</Text><Text style={styles.headerTitle}>Editar lista</Text></View><Ionicons name="create-outline" size={21} color={colors.accent} /></View><Text style={styles.label}>TÍTULO</Text><TextInput value={title} onChangeText={setTitle} style={styles.input} maxLength={80} placeholder="Nombre de la lista" placeholderTextColor={colors.dim} /><Text style={styles.label}>DESCRIPCIÓN</Text><TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.descriptionInput]} maxLength={240} multiline placeholder="Qué hace especial esta selección" placeholderTextColor={colors.dim} /><Text style={styles.label}>VISIBILIDAD</Text><View style={styles.options}><Pressable onPress={() => setVisibility('public')} style={[styles.option, visibility === 'public' && styles.optionActive]}><Ionicons name="globe-outline" size={15} color={visibility === 'public' ? colors.background : colors.muted} /><Text style={[styles.optionText, visibility === 'public' && styles.optionTextActive]}>Pública</Text></Pressable><Pressable onPress={() => setVisibility('private')} style={[styles.option, visibility === 'private' && styles.optionActive]}><Ionicons name="lock-closed-outline" size={15} color={visibility === 'private' ? colors.background : colors.muted} /><Text style={[styles.optionText, visibility === 'private' && styles.optionTextActive]}>Privada</Text></Pressable></View>{mutation.isError ? <Text style={styles.error}>No pudimos actualizar la lista.</Text> : null}<Pressable style={[styles.primary, (!title.trim() || mutation.isPending) && styles.disabled]} disabled={!title.trim() || mutation.isPending} onPress={() => mutation.mutate()}><Text style={styles.primaryText}>{mutation.isPending ? 'Guardando…' : 'Guardar cambios'}</Text><Ionicons name="checkmark" size={18} color={colors.background} /></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 3 },
  label: { color: colors.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.md, marginBottom: 7 },
  input: { minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 13, fontSize: 14 },
  descriptionInput: { minHeight: 110, paddingTop: 13, textAlignVertical: 'top' },
  options: { flexDirection: 'row', gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: colors.surface },
  optionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  optionTextActive: { color: colors.background },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.md },
  primary: { backgroundColor: colors.accent, minHeight: 53, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: spacing.xl },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  secondaryText: { color: colors.accent, fontSize: 12, fontWeight: '900' }
});
