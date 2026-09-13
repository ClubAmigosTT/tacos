import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { lists as fixtureLists } from '@/data/fixtures';
import { feed as feedRequest, isDemoMode, lists as listsRequest, recommendations } from '@/lib/api';
import { localRecommendations } from '@/lib/localCatalog';
import { useAuth } from '@/lib/auth';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';
import { SectionTitle } from '@/components/SectionTitle';
import { RatingBadge } from '@/components/RatingBadge';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { BrandMark } from '@/components/DesignSystem';
import { CatalogImage } from '@/components/CatalogImage';

export default function HomeScreen() {
  const { token, user, loading: authLoading } = useAuth();
  const [search, setSearch] = useState('');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const demoMode = isDemoMode();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) return;
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) setCoordinates({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      } catch { /* Location improves ranking but is never required to open the app. */ }
    })();
    return () => { active = false; };
  }, []);
  const { data = [], isError: recommendationsError, refetch: refetchRecommendations } = useQuery({ queryKey: ['recommendations', token, coordinates?.latitude, coordinates?.longitude], queryFn: () => recommendations(token, coordinates), initialData: () => localRecommendations(coordinates), enabled: !authLoading });
  const { data: feedData, isError: feedError, refetch: refetchFeed } = useQuery({ queryKey: ['feed', 'home', token], queryFn: () => feedRequest(token!), enabled: !authLoading && Boolean(token), staleTime: 60_000 });
  const { data: listData, isError: listsError, refetch: refetchLists } = useQuery({ queryKey: ['lists', 'home', token], queryFn: () => listsRequest(token), enabled: !authLoading, staleTime: 60_000 });
  const featured = data[0];
  const featuredTaco = featured?.tacos.reduce((best, taco) => taco.rating > (best?.rating ?? 0) ? taco : best, featured.tacos[0]);
  const hour = new Date().getHours();
  const moment = hour >= 22 || hour < 4 ? 'DE MADRUGADA' : hour < 12 ? 'PARA DESAYUNAR' : 'AHORA';
  const activityItems = feedData?.items ?? [];
  const activityNeighborhoods = [...new Set(activityItems.map((item) => item.neighborhood).filter(Boolean))].slice(0, 2).join(' / ');
  const homeList = listData?.lists.find((list) => list.visibility !== 'private') ?? (!token && demoMode ? fixtureLists[0] : undefined);
  const listOwner = homeList?.owner.displayName ? `Por @${homeList.owner.displayName.toLowerCase().replace(/\s+/g, '')}` : 'Curaduría de la comunidad';

  function submitSearch() {
    const query = search.trim();
    if (query) router.push({ pathname: '/(tabs)/map', params: { q: query } });
    else router.push('/(tabs)/map');
  }

  if (authLoading) return <View style={styles.loading}><Text style={styles.loadingText}>Preparando tu mapa de sabor…</Text></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{user ? `PARA ${user.displayName.toUpperCase()} · CDMX` : `CDMX · ${moment}`}</Text>
          <BrandMark />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir mi perfil" style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}><Text style={styles.avatarText}>{user?.displayName.slice(0, 1).toUpperCase() ?? 'M'}</Text></Pressable>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput accessibilityLabel="Buscar tacos, taquerías o zonas" value={search} onChangeText={setSearch} onSubmitEditing={submitSearch} placeholder="¿Qué se te antoja?" placeholderTextColor={colors.textSecondary} style={styles.searchInput} returnKeyType="search" />
        <Pressable accessibilityRole="button" accessibilityLabel="Ejecutar búsqueda" style={styles.searchShortcut} onPress={submitSearch}><Text style={styles.shortcutText}>↵</Text></Pressable>
      </View>

      {recommendationsError && !demoMode && !data.length ? <View style={styles.recommendationError}><AsyncErrorState title={token ? 'No pudimos personalizar tu inicio' : 'No pudimos cargar el catálogo'} detail={token ? 'Tus visitas siguen guardadas. Revisa la conexión para recuperar tus recomendaciones.' : 'Revisa la conexión para ver recomendaciones reales.'} onAction={() => void refetchRecommendations()} /></View> : featured ? (
        <Link href={`/place/${featured.id}`} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={`Abrir recomendación ${featured.name}, ${featuredTaco?.name ?? 'taco'} ${featuredTaco && featuredTaco.rating > 0 ? featuredTaco.rating.toFixed(2) : featured.rating > 0 ? featured.rating.toFixed(2) : 'sin calificación'}`} style={styles.hero}>
            <CatalogImage uri={featured.image} accessibilityLabel={`Imagen de ${featured.name}`} style={styles.heroImage} />
            <View style={styles.heroShade} />
            <View style={styles.heroContent}>
              <View style={styles.heroPill}><Text style={styles.heroPillText}>RECOMENDADO AHORA</Text></View>
              <Text style={styles.heroTitle}>{featuredTaco?.name ?? 'Taco'} preciso{`\n`}cerca de ti.</Text>
              <View style={styles.heroMeta}><RatingBadge rating={featuredTaco?.rating ?? featured.rating} accent /><Text style={styles.heroPlace}>{featured.name} · {featured.distance}</Text>{featured.match != null ? <Text style={styles.heroMatch}>{featured.match}%</Text> : null}</View>
              {featured.friendCount ? <Text style={styles.heroSocial}>{featured.socialMatch}% entre tus amigos · {featured.friendCount} personas</Text> : null}
            </View>
          </Pressable>
        </Link>
      ) : null}

      <View style={styles.section}><SectionTitle eyebrow="cerca de ti" title="¿Dónde comemos?" action="Ver mapa →" onAction={() => router.push('/(tabs)/map')} /><ScrollView horizontal showsHorizontalScrollIndicator={false}>{data.map((place) => <PlaceCard key={place.id} place={place} />)}</ScrollView></View>

      <View style={styles.section}><SectionTitle eyebrow="entre amigos" title="Tus amigos andan comiendo" />{token && feedError ? <View style={styles.activityError}><View style={styles.activityErrorIcon}><Ionicons name="cloud-offline-outline" size={17} color={colors.meatDark} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>No pudimos cargar tu actividad</Text><Text style={styles.activityMeta}>Tus conexiones siguen intactas.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Reintentar actividad" style={styles.activityRetry} onPress={() => void refetchFeed()}><Text style={styles.activityRetryText}>Reintentar</Text></Pressable></View> : <Pressable style={styles.activity} onPress={() => router.push('/feed')}><View style={styles.activityAvatars}>{token && activityItems.length ? activityItems.slice(0, 3).map((item, index) => <View key={`${item.user_id}-${index}`} style={[styles.miniAvatar, { backgroundColor: [colors.avatarTerracotta, colors.avatarBlue, colors.avatarOchre][index] }]}><Text style={styles.miniAvatarText}>{item.display_name.slice(0, 1).toUpperCase()}</Text></View>) : demoMode ? <><View style={[styles.miniAvatar, { backgroundColor: colors.avatarTerracotta }]}><Text style={styles.miniAvatarText}>J</Text></View><View style={[styles.miniAvatar, { backgroundColor: colors.avatarBlue }]}><Text style={styles.miniAvatarText}>A</Text></View><View style={[styles.miniAvatar, { backgroundColor: colors.avatarOchre }]}><Text style={styles.miniAvatarText}>R</Text></View></> : <View style={styles.miniAvatarPlaceholder}><Ionicons name="people-outline" size={16} color={colors.textSecondary} /></View>}</View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{token ? (activityItems.length ? 'Tu círculo está comiendo' : 'Encuentra gente con criterio') : demoMode ? 'Tus amigos están comiendo' : 'Construye tu círculo de tacos'}</Text><Text style={styles.activityMeta}>{token ? (activityItems.length ? `${activityItems.length} registros nuevos${activityNeighborhoods ? ` · ${activityNeighborhoods}` : ''}` : 'Sigue personas para llenar tu mapa social') : demoMode ? '3 registros nuevos · Roma / Narvarte' : 'Entra para seguir personas y ver actividad real'}</Text></View><Ionicons name="arrow-forward" size={17} color={colors.textSecondary} /></Pressable>}</View>

      <View style={styles.section}><SectionTitle eyebrow="para hoy" title="Tacos para esta noche" />{token && listsError ? <View style={styles.listError}><View style={styles.listErrorIcon}><Ionicons name="cloud-offline-outline" size={17} color={colors.meatDark} /></View><View style={styles.listCopy}><Text style={styles.listTitle}>No pudimos cargar las listas</Text><Text style={styles.listMeta}>La curaduría sigue intacta.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Reintentar listas" style={styles.listRetry} onPress={() => void refetchLists()}><Text style={styles.listRetryText}>Reintentar</Text></Pressable></View> : <Pressable style={styles.listCard} onPress={() => router.push('/lists')}><View style={styles.listNumber}><Text style={styles.listNumberText}>{homeList ? String(homeList.itemCount).padStart(2, '0') : '—'}</Text><Text style={styles.listNumberLabel}>LUGARES</Text></View><View style={styles.listCopy}><Text style={styles.listTitle}>{homeList?.title ?? 'Descubre las listas de la comunidad'}</Text><Text style={styles.listMeta}>{homeList ? `${listOwner} · ${homeList.visitedCount}/${homeList.itemCount} visitados` : 'Crea una selección para volver a ella.'}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.textSecondary} /></Pressable>}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 66, paddingBottom: 38 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  kicker: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium, letterSpacing: 1.2, marginBottom: 4 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.meatDark, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  search: { height: 56, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceElevated, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 11, marginBottom: spacing.lg },
  searchInput: { color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 15, flex: 1, paddingVertical: 0 },
  searchShortcut: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.xs, paddingHorizontal: 8, paddingVertical: 5 },
  shortcutText: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  hero: { height: 330, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.xl, backgroundColor: colors.surfaceElevated, ...shadows.floating },
  heroImage: { width: '100%', height: '100%' },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  heroContent: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  heroPill: { alignSelf: 'flex-start', backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7, marginBottom: 12 },
  heroPillText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1 },
  heroTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 34, lineHeight: 35, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.display, marginBottom: 15 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heroPlace: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium, flex: 1 },
  heroMatch: { color: colors.cilantroLight, fontFamily: typography.fontFamily.bold, fontSize: 13, fontWeight: typography.weight.bold },
  heroSocial: { color: colors.textPrimary, opacity: 0.75, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium, marginTop: 8 },
  recommendationError: { minHeight: 260, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  activity: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: 12, ...shadows.card },
  activityAvatars: { flexDirection: 'row', width: 66 },
  miniAvatar: { width: 30, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, marginRight: -7 },
  miniAvatarPlaceholder: { width: 30, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 2, borderColor: colors.surface },
  miniAvatarText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  activityCopy: { flex: 1 },
  activityTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  activityMeta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 4 },
  activityError: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...shadows.card },
  activityErrorIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  activityRetry: { borderRadius: radii.pill, backgroundColor: colors.tortilla, paddingHorizontal: 11, paddingVertical: 8 },
  activityRetryText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  listCard: { flexDirection: 'row', alignItems: 'center', gap: 15, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, padding: spacing.md, ...shadows.card },
  listNumber: { alignItems: 'center', justifyContent: 'center', width: 58, height: 58, borderRadius: radii.sm, backgroundColor: colors.tortilla },
  listNumberText: { color: colors.meatDark, fontFamily: typography.fontFamily.bold, fontSize: 25, fontWeight: typography.weight.bold, lineHeight: 26 },
  listNumberLabel: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 7, fontWeight: typography.weight.semibold, letterSpacing: 0.8 },
  listCopy: { flex: 1 },
  listTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 15, fontWeight: typography.weight.semibold },
  listMeta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 5 },
  listError: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...shadows.card },
  listErrorIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.salsa, alignItems: 'center', justifyContent: 'center' },
  listRetry: { borderRadius: radii.pill, backgroundColor: colors.tortilla, paddingHorizontal: 11, paddingVertical: 8 },
  listRetryText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold }
});
