import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, getPlace, savedPlaces } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function SavedScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data: savedData, isLoading: loadingIds, isError: idsError, refetch: refetchIds } = useQuery({ queryKey: ['saved-places', token], queryFn: () => savedPlaces(token!), enabled: Boolean(token && !authLoading) });
  const ids = savedData?.placeIds ?? [];
  const { data: savedDetails = { places: [], unavailableIds: [] as string[] }, isLoading: loadingPlaces, isError: placesError, refetch: refetchPlaces } = useQuery({
    queryKey: ['saved-place-details', ids, token],
    queryFn: async () => {
      const results = await Promise.all(ids.map(async (id) => {
        try {
          return { place: await getPlace(id, token) };
        } catch (cause) {
          // A removed branch should not hide the rest of the user's radar;
          // transient failures still reject so the retry state remains honest.
          if (cause instanceof ApiError && cause.status === 404) return { unavailableId: id };
          throw cause;
        }
      }));
      return {
        places: results.flatMap((result) => result.place ? [result.place] : []),
        unavailableIds: results.flatMap((result) => result.unavailableId ? [result.unavailableId] : [])
      };
    },
    enabled: Boolean(token && !authLoading && savedData !== undefined)
  });
  const places = savedDetails.places;
  const unavailableCount = savedDetails.unavailableIds.length;
  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu radar…</Text></View>;
  if (!token) return <View style={styles.center}><View style={styles.icon}><Ionicons name="bookmark-outline" size={24} color={colors.background} /></View><Text style={styles.title}>Tu radar necesita una cuenta</Text><Text style={styles.muted}>Entra para guardar lugares y volver a ellos cuando llegue el antojo.</Text><Pressable style={styles.primary} onPress={() => router.push('/auth')}><Text style={styles.primaryText}>Entrar o crear cuenta</Text></Pressable></View>;
  if (idsError || placesError) return <AsyncErrorState title="No pudimos cargar tu radar" detail="Tus lugares guardados siguen intactos. Revisa la conexión e inténtalo de nuevo." onAction={() => { void refetchIds(); if (savedData !== undefined) void refetchPlaces(); }} />;
  const loading = loadingIds || loadingPlaces;
  const header = <View>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View><Text style={styles.eyebrow}>TU RADAR</Text><Text style={styles.headerTitle}>Quiero ir</Text></View><Ionicons name="bookmark" size={21} color={colors.tortilla} /></View>
    <Text style={styles.intro}>Lugares que guardaste para una próxima salida, una noche larga o un antojo pendiente.</Text>
    {!loading && unavailableCount ? <View style={styles.notice}><Ionicons name="information-circle-outline" size={17} color={colors.salsa} /><Text style={styles.noticeText}>{unavailableCount} lugar{unavailableCount === 1 ? '' : 'es'} guardado{unavailableCount === 1 ? '' : 's'} ya no está disponible.</Text><Pressable accessibilityRole="button" accessibilityLabel="Actualizar lugares guardados" onPress={() => void refetchPlaces()}><Ionicons name="refresh-outline" size={17} color={colors.tortilla} /></Pressable></View> : null}
  </View>;
  const listData = loading ? [] : places;
  const empty = loading ? <Text style={styles.muted}>Cargando tu radar…</Text> : <View style={styles.empty}><Ionicons name="compass-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyTitle}>Tu radar está vacío</Text><Text style={styles.muted}>{unavailableCount ? 'Explora el mapa para reemplazar los lugares que ya no existen.' : 'Abre una taquería y toca “Quiero ir” para guardarla aquí.'}</Text><Pressable style={styles.secondary} onPress={() => router.push('/(tabs)/map')}><Text style={styles.secondaryText}>Explorar el mapa</Text><Ionicons name="arrow-forward" size={17} color={colors.tortilla} /></Pressable></View>;
  return <FlatList data={listData} keyExtractor={(place) => place.id} renderItem={({ item }) => <PlaceCard place={item} compact />} style={styles.screen} contentContainerStyle={styles.content} ListHeaderComponent={header} ListEmptyComponent={empty} showsVerticalScrollIndicator={false} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  icon: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  headerTitle: { color: colors.textPrimary, fontSize: 27, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 3 },
  intro: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, marginBottom: spacing.xl },
  title: { color: colors.textPrimary, fontSize: 26, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, textAlign: 'center' },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  primary: { backgroundColor: colors.tortilla, borderRadius: radii.md, minHeight: 52, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.background, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  empty: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: spacing.md },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.lg, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.lg },
  secondaryText: { color: colors.tortilla, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.md },
  noticeText: { color: colors.textSecondary, flex: 1, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 16 }
});
