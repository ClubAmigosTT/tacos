import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPlace } from '@/lib/api';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';

const flavorLabels = [
  { key: 'intensity', label: 'Intensidad' },
  { key: 'spicy', label: 'Picante' },
  { key: 'traditional', label: 'Tradicional' },
  { key: 'texture', label: 'Textura' },
  { key: 'value', label: 'Valor' }
] as const;

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: place } = useQuery({ queryKey: ['place', id], queryFn: () => getPlace(id), enabled: Boolean(id) });
  if (!place) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando lugar…</Text></View>;
  return <><Stack.Screen options={{ headerShown: false }} /><ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.cover}><Image source={{ uri: place.image }} style={styles.coverImage} /><View style={styles.coverShade} /><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={23} color={colors.ink} /></Pressable><Pressable style={styles.save} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="bookmark-outline" size={20} color={colors.ink} /></Pressable><View style={styles.coverCopy}><View style={styles.pill}><Text style={styles.pillText}>{place.style.toUpperCase()}</Text></View><Text style={styles.name}>{place.name}</Text><Text style={styles.location}>{place.neighborhood} · Abierto hasta {place.openUntil}</Text></View></View><View style={styles.body}><View style={styles.stats}><View><Text style={styles.rating}>{place.rating.toFixed(2)}</Text><Text style={styles.statLabel}>GLOBAL</Text></View><View><Text style={styles.ratingAccent}>{place.match}%</Text><Text style={styles.statLabel}>PARA TI</Text></View><View><Text style={styles.rating}>{place.distance}</Text><Text style={styles.statLabel}>DISTANCIA</Text></View></View><Text style={styles.description}>{place.description}</Text>{place.taqueriaId ? <Pressable style={styles.parentLink} onPress={() => router.push(`/taqueria/${place.taqueriaId}`)}><Text style={styles.parentLinkText}>Ver {place.taqueriaName ?? 'taquería'} y sus sucursales →</Text></Pressable> : null}<View style={styles.actionRow}><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/register', params: { placeId: place.id } })}><Ionicons name="add" size={18} color={colors.background} /><Text style={styles.primaryText}>Registrar visita</Text></Pressable><Pressable style={styles.secondary} onPress={() => router.push({ pathname: '/lists', params: { placeId: place.id } })}><Ionicons name="bookmark-outline" size={18} color={colors.ink} /><Text style={styles.secondaryText}>Guardar lista</Text></Pressable></View><View style={styles.section}><Text style={styles.sectionEyebrow}>QUÉ PEDIR AQUÍ</Text><Text style={styles.sectionTitle}>Cada taco cuenta.</Text>{place.tacos.map((taco) => <View key={taco.id} style={styles.taco}><View style={styles.tacoInfo}><Text style={styles.tacoName}>{taco.name}</Text><Text style={styles.tacoNote}>{taco.note}</Text></View><View style={styles.tacoScore}><RatingBadge rating={taco.rating} accent /><Text style={styles.price}>${taco.price}</Text></View></View>)}</View><View style={styles.profile}><Text style={styles.sectionEyebrow}>PERFIL DE SABOR</Text>{flavorLabels.map(({ key, label }) => <View key={key} style={styles.profileRow}><Text style={styles.profileLabel}>{label}</Text><View style={styles.bar}><View style={[styles.fill, { width: (place.flavorProfile[key] + '%') as any }]} /></View><Text style={styles.profileValue}>{place.flavorProfile[key]}</Text></View>)}</View></View></ScrollView></>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 45 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.muted },
  cover: { height: 410, backgroundColor: colors.surfaceRaised },
  coverImage: { width: '100%', height: '100%' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,5,4,0.42)' },
  back: { position: 'absolute', top: 57, left: spacing.lg, width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.82)', alignItems: 'center', justifyContent: 'center' },
  save: { position: 'absolute', top: 57, right: spacing.lg, width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.82)', alignItems: 'center', justifyContent: 'center' },
  coverCopy: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  pillText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  name: { color: colors.ink, fontSize: 37, fontWeight: '900', letterSpacing: -1.2 },
  location: { color: colors.ink, opacity: 0.86, fontSize: 12, fontWeight: '700', marginTop: 6 },
  body: { padding: spacing.lg },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  rating: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  ratingAccent: { color: colors.accent, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: spacing.lg },
  parentLink: { marginTop: spacing.md, paddingVertical: 8 },
  parentLinkText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: spacing.lg },
  primary: { flex: 1, backgroundColor: colors.accent, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondary: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  secondaryText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  section: { marginTop: spacing.xxl },
  sectionEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  sectionTitle: { color: colors.ink, fontSize: 25, fontWeight: '900', marginTop: 5, marginBottom: spacing.md },
  taco: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.md },
  tacoInfo: { flex: 1, paddingRight: spacing.md },
  tacoName: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  tacoNote: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  tacoScore: { alignItems: 'flex-end', gap: 5 },
  price: { color: colors.warm, fontSize: 11, fontWeight: '800' },
  profile: { marginTop: spacing.xxl, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: spacing.md },
  profileLabel: { color: colors.muted, width: 72, fontSize: 11 },
  bar: { flex: 1, height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  profileValue: { color: colors.ink, width: 23, textAlign: 'right', fontSize: 11, fontWeight: '900' }
});
