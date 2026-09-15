import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { useAuth } from '@/lib/auth';
import { diary as diaryRequest, isDemoMode, lists as listsRequest, taste as tasteRequest, trackEvent } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { router, useIsFocused, usePathname } from 'expo-router';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { TasteSignature } from '@/components/TasteSignature';
import { TacoChip } from '@/components/DesignSystem';

const profileTabs = [
  { label: 'Diario', path: '/(tabs)/diary' },
  { label: 'Reviews', path: '/reviews' },
  { label: 'Listas', path: '/lists' },
  { label: 'Mapa', path: '/(tabs)/map' },
  { label: 'Estadísticas', path: '/stats' }
] as const;

export default function ProfileScreen() {
  const { user, token, loading: authLoading, signOut } = useAuth();
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isVisible = isFocused || pathname === '/profile' || pathname.endsWith('/profile');
  useEffect(() => { if (isVisible) void trackEvent('profile_open', {}, token); }, [isVisible, token]);
  const { data, isError: diaryError, refetch: refetchDiary } = useQuery({ queryKey: ['diary', 'profile', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token && !authLoading && isVisible) });
  const { data: listData, isError: listsError, refetch: refetchLists } = useQuery({ queryKey: ['lists', 'profile', token], queryFn: () => listsRequest(token), enabled: Boolean(token && !authLoading && isVisible) });
  const { data: tasteData, isError: tasteError, refetch: refetchTaste } = useQuery({ queryKey: ['taste', token], queryFn: () => tasteRequest(token!), enabled: Boolean(token && !authLoading && isVisible) });
  const entries = data?.entries ?? [];
  const demoMode = isDemoMode();
  const visits = user ? entries.length : demoMode ? 17 : '—';
  const average = user ? (entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—') : demoMode ? '4.21' : '—';
  const listCount = user ? (listData?.lists.filter((list) => list.owner.id === user.id).length ?? 0) : demoMode ? 12 : '—';
  const exploredZones = user ? new Set(entries.map((entry) => entry.neighborhood).filter(Boolean)).size : demoMode ? 3 : '—';
  const tasteId = tasteData?.taste;
  const hasTasteData = Boolean(user && tasteId?.hasData);
  const hasVisitData = Boolean(user && entries.length);
  if (!isVisible) return <View style={styles.screen} />;
  if (authLoading) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando tu perfil…</Text></View>;
  if (user && (diaryError || listsError || tasteError)) return <AsyncErrorState title="No pudimos cargar tu perfil" detail="Tu diario y tus listas siguen guardados. Comprueba la conexión e inténtalo de nuevo." onAction={() => { void refetchDiary(); void refetchLists(); void refetchTaste(); }} />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.top}><View style={styles.avatar}><Text style={styles.avatarText}>{(user?.displayName ?? 'T').slice(0, 1).toUpperCase()}</Text></View><View style={styles.topCopy}><Text style={styles.name}>{user?.displayName ?? 'Tu perfil'}</Text><Text style={styles.location}>{user?.email ?? 'Explora sin cuenta'}</Text></View>{user ? <Pressable accessibilityRole="button" accessibilityLabel="Abrir ajustes" onPress={() => router.push('/settings')}><Ionicons name="settings-outline" size={21} color={colors.textSecondary} /></Pressable> : <Ionicons name="settings-outline" size={21} color={colors.textSecondary} />}</View>
      {!user ? <View style={styles.guestActions}>
        <Text style={styles.guestTitle}>Tu perfil empieza con una cuenta</Text>
        <Text style={styles.guestCopy}>Registra visitas, crea listas y conserva tus calificaciones en cualquier dispositivo.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Crear cuenta" style={styles.guestPrimary} onPress={() => router.push('/auth')}><Text style={styles.guestPrimaryText}>Crear cuenta</Text><Ionicons name="arrow-forward" size={17} color={colors.background} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Explorar mapa" style={styles.guestSecondary} onPress={() => router.push('/(tabs)/map')}><Ionicons name="map-outline" size={17} color={colors.tortilla} /><Text style={styles.guestSecondaryText}>Explorar mapa</Text></Pressable>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" style={styles.logout} onPress={() => void signOut()}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>}
      {hasTasteData ? <View style={styles.taste}><Text style={styles.tasteEyebrow}>TU TASTE ID</Text><Text style={styles.tasteTitle}>{tasteId?.title}</Text><Text style={styles.tasteDescription}>{tasteId?.description}</Text><View style={styles.tags}>{tasteId?.tags.map((tag) => <Text style={styles.tag} key={tag}>{tag}</Text>)}</View><TasteSignature profile={tasteId?.profile} /></View> : null}
      {hasVisitData ? <View style={styles.stats}><View><Text style={styles.statNumber}>{visits}</Text><Text style={styles.statLabel}>VISITAS</Text></View><View><Text style={styles.statNumber}>{listCount}</Text><Text style={styles.statLabel}>LISTAS</Text></View><View><Text style={styles.statNumber}>{average}</Text><Text style={styles.statLabel}>PROMEDIO</Text></View></View> : null}
      {user && !hasVisitData ? <View style={styles.profileEmpty}><Ionicons name="restaurant-outline" size={22} color={colors.tortilla} /><Text style={styles.profileEmptyTitle}>Todavía no tienes visitas</Text><Text style={styles.profileEmptyCopy}>Explora el mapa y registra tu primer taco para activar tus estadísticas.</Text><Pressable accessibilityRole="button" accessibilityLabel="Explorar mapa" style={styles.profileEmptyButton} onPress={() => router.push('/(tabs)/map')}><Text style={styles.profileEmptyButtonText}>Explorar mapa</Text></Pressable></View> : null}
      {user ? <><ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.profileTabs} style={styles.profileTabsScroll}>
        {profileTabs.map((tab, index) => <TacoChip key={tab.label} label={tab.label} selected={index === 0} accessibilityRole="tab" accessibilityLabel={`Abrir ${tab.label}`} onPress={() => router.push(tab.path)} />)}
      </ScrollView>
      <Text style={styles.sectionTitle}>Así comes tú</Text>
      <View style={styles.menu}><MenuRow icon="book-outline" title="Diario" detail={`${visits} visitas registradas`} onPress={() => router.push('/(tabs)/diary')} /><MenuRow icon="chatbubble-ellipses-outline" title="Reviews" detail="Tus ratings y notas personales" onPress={() => router.push('/reviews')} /><MenuRow icon="stats-chart-outline" title="Estadísticas" detail="Tu ritmo, zonas y tacos favoritos" onPress={() => router.push('/stats')} /><MenuRow icon="list-outline" title="Listas" detail={`${listCount} listas públicas`} onPress={() => router.push('/lists')} /><MenuRow icon="bookmark-outline" title="Quiero ir" detail="Tu radar de lugares pendientes" onPress={() => router.push('/saved')} /><MenuRow icon="people-outline" title="Actividad" detail="Sigue a gente con criterio" onPress={() => router.push('/feed')} /><MenuRow icon="map-outline" title="Mapa personal" detail={`${exploredZones} colonias exploradas`} onPress={() => router.push('/(tabs)/map')} /><MenuRow icon="compass-outline" title="Taco Passport" detail="Desbloquea zonas de la ciudad" onPress={() => router.push('/passport')} /><MenuRow icon="sparkles-outline" title="Resumen anual" detail="Tus tacos en una sola historia" onPress={() => router.push('/wrapped')} />{user?.role === 'admin' ? <MenuRow icon="shield-checkmark-outline" title="Moderación" detail="Revisa reportes de la comunidad" onPress={() => router.push('/admin')} /> : null}<MenuRow icon="shield-checkmark-outline" title="Privacidad" detail="Controla si tus visitas aparecen en Actividad" onPress={() => router.push('/privacy')} last /></View></> : null}
    </ScrollView>
  );
}

function MenuRow({ icon, title, detail, last = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; last?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} style={[styles.menuRow, !last && styles.menuBorder]} onPress={onPress} disabled={!onPress}><View style={styles.menuIcon}><Ionicons name={icon} size={18} color={colors.cilantroLight} /></View><View style={{ flex: 1 }}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textTertiary} /></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular },
  content: { padding: spacing.lg, paddingTop: 66, paddingBottom: 115 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.meatDark, fontFamily: typography.fontFamily.bold, fontSize: 25, fontWeight: typography.weight.bold },
  topCopy: { flex: 1 },
  name: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 27, fontWeight: typography.weight.bold, letterSpacing: -0.7 },
  location: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, marginTop: 3 },
  taste: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  tasteEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose },
  tasteTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 27, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 15 },
  tasteDescription: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 270 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 18 },
  tag: { color: colors.meatDark, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xl, ...shadows.card },
  statNumber: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 24, fontWeight: typography.weight.bold },
  statLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1, marginTop: 4 },
  profileTabsScroll: { marginBottom: spacing.xl },
  profileTabs: { gap: 8, paddingRight: spacing.lg },
  sectionTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 20, fontWeight: typography.weight.semibold, marginBottom: spacing.md },
  menu: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.md, ...shadows.card },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.md },
  menuBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 34, height: 34, borderRadius: radii.xs, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  menuDetail: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 3 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tortilla, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.md },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  loginDetail: { color: colors.meatDark, opacity: 0.72, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 3 },
  guestActions: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.card },
  guestTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 19, fontWeight: typography.weight.semibold },
  guestCopy: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: 7 },
  guestPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingVertical: 12, marginTop: spacing.lg },
  guestPrimaryText: { color: colors.background, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  guestSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, marginTop: 4 },
  guestSecondaryText: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  profileEmpty: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.card },
  profileEmptyTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 17, fontWeight: typography.weight.semibold, marginTop: 8 },
  profileEmptyCopy: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  profileEmptyButton: { backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: spacing.md },
  profileEmptyButtonText: { color: colors.background, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold },
  logout: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 8, marginBottom: spacing.lg },
  logoutText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium }
});
