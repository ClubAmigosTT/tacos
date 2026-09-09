import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { colors, radii, spacing } from '@/theme';
import { useAuth } from '@/lib/auth';
import { passport as passportRequest, type PassportZone } from '@/lib/api';
import { AsyncErrorState } from '@/components/AsyncErrorState';

const zones = [
  { name: 'Narvarte', note: 'Pastor y suadero' },
  { name: 'Roma Sur', note: 'Clásicos de madrugada' },
  { name: 'Condesa', note: 'Taco contemporáneo' },
  { name: 'Centro', note: 'Historia en cada esquina' },
  { name: 'Del Valle', note: 'Joyas de barrio' },
  { name: 'Juárez', note: 'Nuevas aperturas' },
  { name: 'Coyoacán', note: 'Ruta de fin de semana' },
  { name: 'Escandón', note: 'Sabor de culto' },
];
const anonymousZones: PassportZone[] = zones.map((zone) => ({ ...zone, branchCount: 0, visitCount: 0, unlocked: false }));

export default function PassportScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['passport', token],
    queryFn: () => passportRequest(token!),
    enabled: Boolean(token),
  });
  const displayZones = data?.zones ?? anonymousZones;
  const visitedCount = data?.visitedZones ?? displayZones.filter((zone) => zone.unlocked).length;
  const totalZones = data?.totalZones ?? displayZones.length;
  const progress = totalZones ? Math.round((visitedCount / totalZones) * 100) : 0;

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu pasaporte…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tu pasaporte" detail="Tus zonas visitadas siguen guardadas. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={colors.ink} /></Pressable>
        <View><Text style={styles.eyebrow}>EXPLORACIÓN</Text><Text style={styles.title}>Taco Passport</Text></View>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroTop}><View><Text style={styles.heroEyebrow}>CIUDAD DE MÉXICO</Text><Text style={styles.heroTitle}>{visitedCount} de {totalZones} zonas</Text></View><View style={styles.stamp}><Ionicons name="compass-outline" size={25} color={colors.background} /><Text style={styles.stampText}>CDMX</Text></View></View>
        <Text style={styles.heroCopy}>{isLoading ? 'Cargando tu ruta…' : visitedCount ? 'Cada visita deja una marca. Sigue trazando tu mapa de sabor.' : 'Registra tu primer taco para empezar a desbloquear la ciudad.'}</Text>
        <View style={styles.progressTrack}><View style={[styles.progress, { width: (progress + '%') as any }]} /></View>
        <Text style={styles.progressLabel}>{progress}% explorado</Text>
      </View>

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Tu mapa coleccionable</Text><Text style={styles.sectionMeta}>{visitedCount} desbloqueadas</Text></View>
      <View style={styles.grid}>
        {displayZones.map((zone) => {
          const unlocked = zone.unlocked;
          return <View key={zone.name} style={[styles.zone, unlocked && styles.zoneUnlocked]}><View style={[styles.zoneIcon, unlocked && styles.zoneIconUnlocked]}><Ionicons name={unlocked ? 'checkmark' : 'lock-closed-outline'} size={17} color={unlocked ? colors.background : colors.dim} /></View><Text style={styles.zoneName}>{zone.name}</Text><Text style={styles.zoneNote}>{unlocked ? `${zone.visitCount} visita${zone.visitCount === 1 ? '' : 's'}` : zone.note}</Text>{unlocked && <View style={styles.badge}><Text style={styles.badgeText}>LISTA</Text></View>}</View>;
        })}
      </View>

      {!token && <Pressable style={styles.cta} onPress={() => router.push('/auth')}><View style={{ flex: 1 }}><Text style={styles.ctaTitle}>Guarda cada descubrimiento</Text><Text style={styles.ctaCopy}>Entra para desbloquear zonas con tus visitas.</Text></View><Ionicons name="arrow-forward" size={19} color={colors.background} /></Pressable>}
      {token && !visitedCount && <Pressable style={styles.cta} onPress={() => router.push('/register')}><View style={{ flex: 1 }}><Text style={styles.ctaTitle}>Empieza tu ruta</Text><Text style={styles.ctaCopy}>Registra un taco y desbloquea tu primera zona.</Text></View><Ionicons name="arrow-forward" size={19} color={colors.background} /></Pressable>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.muted, fontSize: 13 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.8, marginTop: 3 },
  hero: { backgroundColor: colors.surfaceRaised, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroEyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: colors.ink, fontSize: 31, fontWeight: '900', letterSpacing: -1.1, marginTop: 9 },
  stamp: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  stampText: { color: colors.background, fontSize: 9, fontWeight: '900', marginTop: 1, letterSpacing: 0.8 },
  heroCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 17, maxWidth: 285 },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden', marginTop: 20 },
  progress: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  progressLabel: { color: colors.accent, fontSize: 10, fontWeight: '900', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.7 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  sectionMeta: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  zone: { width: '48%', minHeight: 132, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  zoneUnlocked: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  zoneIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  zoneIconUnlocked: { backgroundColor: colors.accent },
  zoneName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  zoneNote: { color: colors.muted, fontSize: 10, marginTop: 4, lineHeight: 15 },
  badge: { position: 'absolute', right: 10, top: 10, borderRadius: radii.pill, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: colors.background, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.xl },
  ctaTitle: { color: colors.background, fontSize: 15, fontWeight: '900' },
  ctaCopy: { color: colors.background, opacity: 0.72, fontSize: 11, marginTop: 4 },
});
