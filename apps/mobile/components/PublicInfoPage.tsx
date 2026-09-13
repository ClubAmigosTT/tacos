import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '@/theme';

type Section = { title: string; body: ReactNode };

export function PublicInfoPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: string; sections: Section[] }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.mark}>tacos<Text style={styles.dot}>.</Text></Text>
      </View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.intro}>{intro}</Text>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}
      <Text style={styles.footer}>Club Amigos TT · Ciudad de México</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: spacing.lg, paddingTop: 54, paddingBottom: 90 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mark: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 25, fontWeight: typography.weight.bold, letterSpacing: -1.2 },
  dot: { color: colors.cilantroLight },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 34, lineHeight: 38, fontWeight: typography.weight.bold, letterSpacing: -1.1, marginTop: 8 },
  intro: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 15, lineHeight: 23, marginTop: spacing.md, marginBottom: spacing.lg },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 16, fontWeight: typography.weight.semibold, marginBottom: 9 },
  body: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 21 },
  link: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  footer: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 11, textAlign: 'center', marginTop: spacing.lg }
});
