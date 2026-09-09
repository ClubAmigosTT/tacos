import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '@/theme';

export default function NotFoundScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}><Text style={styles.markText}>tacos<Text style={styles.dot}>.</Text></Text></View>
      <View style={styles.icon}><Ionicons name="map-outline" size={28} color={colors.accent} /></View>
      <Text style={styles.eyebrow}>CALLE NO ENCONTRADA</Text>
      <Text style={styles.title}>Este lugar no aparece en el mapa.</Text>
      <Text style={styles.copy}>El enlace puede haber cambiado o la taquería ya no está disponible.</Text>
      <Pressable style={styles.primary} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.primaryText}>Volver a Inicio</Text>
        <Ionicons name="arrow-forward" size={17} color={colors.background} />
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.replace('/(tabs)/map')}>
        <Text style={styles.secondaryText}>Abrir el mapa</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  mark: { position: 'absolute', top: 64, left: spacing.lg },
  markText: { color: colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -1.4 },
  dot: { color: colors.accent },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' },
  title: { color: colors.ink, fontSize: 29, lineHeight: 32, fontWeight: '900', letterSpacing: -0.8, textAlign: 'center', maxWidth: 360, marginTop: 8 },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 340, marginTop: spacing.md },
  primary: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.accent, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.xl, minWidth: 190 },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondary: { minHeight: 42, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  secondaryText: { color: colors.muted, fontSize: 12, fontWeight: '800' }
});
