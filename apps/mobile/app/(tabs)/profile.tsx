import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '@/theme';
import { useAuth } from '@/lib/auth';
import { diary as diaryRequest, lists as listsRequest, taste as tasteRequest } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const { user, token, signOut } = useAuth();
  const { data } = useQuery({ queryKey: ['diary', 'profile', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token) });
  const { data: listData } = useQuery({ queryKey: ['lists', 'profile', token], queryFn: () => listsRequest(token), enabled: true });
  const { data: tasteData } = useQuery({ queryKey: ['taste', token], queryFn: () => tasteRequest(token!), enabled: Boolean(token) });
  const entries = data?.entries ?? [];
  const visits = user ? entries.length : 17;
  const average = user ? (entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—') : '4.21';
  const listCount = user ? (listData?.lists.filter((list) => list.owner.id === user.id).length ?? 0) : 12;
  const tasteId = tasteData?.taste;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.top}><View style={styles.avatar}><Text style={styles.avatarText}>{(user?.displayName ?? 'M').slice(0, 1).toUpperCase()}</Text></View><View style={styles.topCopy}><Text style={styles.name}>{user?.displayName ?? 'Marcelo'}</Text><Text style={styles.location}>{user?.email ?? 'Ciudad de México · 2026'}</Text></View><Ionicons name="settings-outline" size={21} color={colors.muted} /></View>
      {!user ? <Pressable style={styles.loginCard} onPress={() => router.push('/auth')}><View style={styles.loginIcon}><Ionicons name="person-add-outline" size={18} color={colors.background} /></View><View style={{ flex: 1 }}><Text style={styles.loginTitle}>Guarda tu historia</Text><Text style={styles.loginDetail}>Entra para registrar visitas y crear listas.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable> : <Pressable style={styles.logout} onPress={() => void signOut()}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>}
      <View style={styles.taste}><Text style={styles.tasteEyebrow}>TU TASTE ID</Text><Text style={styles.tasteTitle}>{tasteId?.title ?? 'Pastor nocturno'}</Text><Text style={styles.tasteDescription}>{tasteId?.description ?? 'Picante alto · precio sensible · explorador de lugares callejeros'}</Text><View style={styles.tags}>{(tasteId?.tags ?? ['PASTOR 92%', 'PICANTE 84%', 'NOCHE 78%']).map((tag) => <Text style={styles.tag} key={tag}>{tag}</Text>)}</View></View>
      <View style={styles.stats}><View><Text style={styles.statNumber}>{visits}</Text><Text style={styles.statLabel}>VISITAS</Text></View><View><Text style={styles.statNumber}>{listCount}</Text><Text style={styles.statLabel}>LISTAS</Text></View><View><Text style={styles.statNumber}>{average}</Text><Text style={styles.statLabel}>PROMEDIO</Text></View></View>
      <Text style={styles.sectionTitle}>Tu identidad gastronómica</Text>
      <View style={styles.menu}><MenuRow icon="book-outline" title="Diario" detail={`${visits} visitas registradas`} onPress={() => router.push('/(tabs)/diary')} /><MenuRow icon="list-outline" title="Listas" detail={`${listCount} listas públicas`} onPress={() => router.push('/lists')} /><MenuRow icon="bookmark-outline" title="Quiero ir" detail="Tu radar de lugares pendientes" onPress={() => router.push('/saved')} /><MenuRow icon="people-outline" title="Actividad" detail="Sigue a gente con criterio" onPress={() => router.push('/feed')} /><MenuRow icon="map-outline" title="Mapa personal" detail="3 colonias exploradas" onPress={() => router.push('/(tabs)/map')} /><MenuRow icon="compass-outline" title="Taco Passport" detail="Desbloquea zonas de la ciudad" onPress={() => router.push('/passport')} /><MenuRow icon="sparkles-outline" title="Resumen anual" detail="Tus tacos en una sola historia" onPress={() => router.push('/wrapped')} />{user?.role === 'admin' ? <MenuRow icon="shield-checkmark-outline" title="Moderación" detail="Revisa reportes de la comunidad" onPress={() => router.push('/admin')} /> : null}<MenuRow icon="shield-checkmark-outline" title="Privacidad" detail="Controla si tus visitas aparecen en Actividad" onPress={() => router.push('/privacy')} last /></View>
    </ScrollView>
  );
}

function MenuRow({ icon, title, detail, last = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; last?: boolean; onPress?: () => void }) {
  return <Pressable style={[styles.menuRow, !last && styles.menuBorder]} onPress={onPress} disabled={!onPress}><View style={styles.menuIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.dim} /></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 66, paddingBottom: 115 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontSize: 25, fontWeight: '900' },
  topCopy: { flex: 1 },
  name: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.7 },
  location: { color: colors.muted, fontSize: 12, marginTop: 3 },
  taste: { backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  tasteEyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  tasteTitle: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginTop: 15 },
  tasteDescription: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 270 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 18 },
  tag: { color: colors.background, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, fontSize: 9, fontWeight: '900' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl },
  statNumber: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', marginBottom: spacing.md },
  menu: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.md },
  menuBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  menuDetail: { color: colors.muted, fontSize: 11, marginTop: 3 },
  loginCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  loginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: colors.background, fontSize: 14, fontWeight: '900' },
  loginDetail: { color: colors.background, opacity: 0.7, fontSize: 11, marginTop: 3 },
  logout: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 8, marginBottom: spacing.lg },
  logoutText: { color: colors.muted, fontSize: 11, fontWeight: '800' }
});
