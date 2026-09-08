import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { recommendations } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';
import { PlaceCard } from '@/components/PlaceCard';
import { SectionTitle } from '@/components/SectionTitle';
import { RatingBadge } from '@/components/RatingBadge';

export default function HomeScreen() {
  const { token, user } = useAuth();
  const { data = [] } = useQuery({ queryKey: ['recommendations', token], queryFn: () => recommendations(token) });
  const featured = data[0];
  const featuredTaco = featured?.tacos.reduce((best, taco) => taco.rating > (best?.rating ?? 0) ? taco : best, featured.tacos[0]);
  const hour = new Date().getHours();
  const moment = hour >= 22 || hour < 4 ? 'DE MADRUGADA' : hour < 12 ? 'PARA DESAYUNAR' : 'AHORA';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{user ? `PARA ${user.displayName.toUpperCase()} · CDMX` : `CDMX · ${moment}`}</Text>
          <Text style={styles.logo}>tacos<Text style={styles.logoDot}>.</Text></Text>
        </View>
        <Pressable style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}><Text style={styles.avatarText}>M</Text></Pressable>
      </View>

      <Pressable style={styles.search} onPress={() => router.push('/(tabs)/map')}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <Text style={styles.searchText}>¿Qué se te antoja?</Text>
        <View style={styles.searchShortcut}><Text style={styles.shortcutText}>⌘ K</Text></View>
      </Pressable>

      {featured ? (
        <Link href={`/place/${featured.id}`} asChild>
          <Pressable style={styles.hero}>
            <Image source={{ uri: featured.image }} style={styles.heroImage} />
            <View style={styles.heroShade} />
            <View style={styles.heroContent}>
              <View style={styles.heroPill}><Text style={styles.heroPillText}>RECOMENDADO AHORA</Text></View>
              <Text style={styles.heroTitle}>{featuredTaco?.name ?? 'Taco'} preciso{`\n`}cerca de ti.</Text>
              <View style={styles.heroMeta}><RatingBadge rating={featured.rating} accent /><Text style={styles.heroPlace}>{featured.name} · {featured.distance}</Text><Text style={styles.heroMatch}>{featured.match}%</Text></View>
            </View>
          </Pressable>
        </Link>
      ) : null}

      <View style={styles.section}><SectionTitle eyebrow="tu mapa" title="Descubre cerca" action="Ver mapa →" /><ScrollView horizontal showsHorizontalScrollIndicator={false}>{data.map((place) => <PlaceCard key={place.id} place={place} />)}</ScrollView></View>

      <View style={styles.section}><SectionTitle eyebrow="actividad" title="Lo que está pasando" /><Pressable style={styles.activity} onPress={() => router.push('/feed')}><View style={styles.activityAvatars}><View style={[styles.miniAvatar, { backgroundColor: '#DF7E54' }]}><Text>J</Text></View><View style={[styles.miniAvatar, { backgroundColor: '#728BC1' }]}><Text>A</Text></View><View style={[styles.miniAvatar, { backgroundColor: '#C08A54' }]}><Text>R</Text></View></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>Tus amigos están comiendo</Text><Text style={styles.activityMeta}>3 registros nuevos · Roma / Narvarte</Text></View><Ionicons name="arrow-forward" size={17} color={colors.muted} /></Pressable></View>

      <View style={styles.section}><SectionTitle eyebrow="selección editorial" title="Listas para esta noche" /><Pressable style={styles.listCard} onPress={() => router.push('/lists')}><View style={styles.listNumber}><Text style={styles.listNumberText}>07</Text><Text style={styles.listNumberLabel}>LUGARES</Text></View><View style={styles.listCopy}><Text style={styles.listTitle}>Pastor después de medianoche</Text><Text style={styles.listMeta}>Por @comelocal · 4.72 promedio</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} /></Pressable></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: 66, paddingBottom: 38 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  kicker: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  logo: { color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.8 },
  logoDot: { color: colors.accent },
  avatar: { width: 38, height: 38, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontWeight: '900' },
  search: { height: 54, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 11, marginBottom: spacing.lg },
  searchText: { color: colors.muted, fontSize: 15, flex: 1 },
  searchShortcut: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  shortcutText: { color: colors.dim, fontSize: 11, fontWeight: '700' },
  hero: { height: 330, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.xl, backgroundColor: colors.surfaceRaised },
  heroImage: { width: '100%', height: '100%' },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,5,4,0.43)' },
  heroContent: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  heroPill: { alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  heroPillText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: colors.ink, fontSize: 34, lineHeight: 35, fontWeight: '900', letterSpacing: -1.2, marginBottom: 15 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heroPlace: { color: colors.ink, fontSize: 12, fontWeight: '700', flex: 1 },
  heroMatch: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  section: { marginBottom: spacing.xl },
  activity: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 12 },
  activityAvatars: { flexDirection: 'row', width: 66 },
  miniAvatar: { width: 30, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, marginRight: -7 },
  activityCopy: { flex: 1 },
  activityTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  activityMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  listCard: { flexDirection: 'row', alignItems: 'center', gap: 15, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, padding: spacing.md },
  listNumber: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 13, backgroundColor: colors.accent },
  listNumberText: { color: colors.background, fontSize: 25, fontWeight: '900', lineHeight: 26 },
  listNumberLabel: { color: colors.background, fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  listCopy: { flex: 1 },
  listTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  listMeta: { color: colors.muted, fontSize: 11, marginTop: 5 }
});
