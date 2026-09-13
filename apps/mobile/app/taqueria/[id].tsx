import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, getTaqueria } from '@/lib/api';
import { colors, radii, spacing, typography } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function TaqueriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: taqueria, isLoading, isError, error, refetch } = useQuery({ queryKey: ['taqueria', id], queryFn: () => getTaqueria(id), enabled: Boolean(id) });
  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando taquería…</Text></View>;
  if (isError && !(error instanceof ApiError && error.status === 404)) return <AsyncErrorState title="No pudimos cargar la taquería" detail="La información no se modificó. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  if (!taqueria) return <View style={styles.center}><Text style={styles.title}>Taquería no disponible</Text><Pressable style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>Volver</Text></Pressable></View>;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><Text style={styles.eyebrow}>TAQUERÍA</Text><Ionicons name="restaurant-outline" size={20} color={colors.tortilla} /></View><Text style={styles.title}>{taqueria.name}</Text><Text style={styles.description}>{taqueria.description}</Text><View style={styles.meta}><Text style={styles.metaAccent}>{taqueria.branchCount} {taqueria.branchCount === 1 ? 'SUCURSAL' : 'SUCURSALES'}</Text><Text style={styles.muted}>misma casa, experiencias distintas</Text></View><Text style={styles.sectionTitle}>Sucursales</Text>{taqueria.branches.map((branch) => <View key={branch.id} style={styles.branch}><PlaceCard place={branch} compact /></View>)}</ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.6 },
  title: { color: colors.textPrimary, fontSize: 31, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -1, lineHeight: 36 },
  description: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, marginTop: 9 },
  meta: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, marginTop: spacing.lg, gap: 4 },
  metaAccent: { color: colors.tortilla, fontSize: 10, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.2 },
  muted: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 18, textAlign: 'center' },
  sectionTitle: { color: colors.textPrimary, fontSize: 23, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.xxl, marginBottom: spacing.md },
  branch: { marginBottom: spacing.sm },
  backButton: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.lg },
  backText: { color: colors.background, fontSize: 12, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold }
});
