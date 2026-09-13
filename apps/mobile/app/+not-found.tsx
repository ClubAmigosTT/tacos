import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '@/theme';

export default function NotFoundScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}><Text style={styles.markText}>tacos<Text style={styles.dot}>.</Text></Text></View>
      <View style={styles.icon}><Ionicons name="map-outline" size={28} color={colors.tortilla} /></View>
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
  markText: { color: colors.textPrimary, fontSize: 28, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -1.4 },
  dot: { color: colors.tortilla },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  eyebrow: { color: colors.tortilla, fontSize: 10, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5, textAlign: 'center' },
  title: { color: colors.textPrimary, fontSize: 29, fontFamily: typography.fontFamily.bold, lineHeight: 32, fontWeight: typography.weight.bold, letterSpacing: -0.8, textAlign: 'center', maxWidth: 360, marginTop: 8 },
  copy: { color: colors.textSecondary, fontSize: 14, fontFamily: typography.fontFamily.regular, lineHeight: 21, textAlign: 'center', maxWidth: 340, marginTop: spacing.md },
  primary: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.tortilla, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.xl, minWidth: 190 },
  primaryText: { color: colors.background, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  secondary: { minHeight: 42, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  secondaryText: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold }
});
