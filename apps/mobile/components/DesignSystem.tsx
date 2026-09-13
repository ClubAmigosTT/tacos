import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, type ImageStyle, type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing, typography } from '@/theme';

type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export function TacoButton({ label, tone = 'primary', icon, style, textStyle, disabled, ...props }: Omit<PressableProps, 'style'> & {
  label: string;
  tone?: ButtonTone;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...props}
      style={({ pressed }) => [styles.button, styles[`button_${tone}`], disabled && styles.disabled, pressed && styles.pressed, style]}
    >
      {icon}
      <Text style={[styles.buttonText, styles[`buttonText_${tone}`], textStyle]}>{label}</Text>
    </Pressable>
  );
}

type ChipTone = 'neutral' | 'success' | 'salsa';

export function TacoChip({ label, selected = false, tone = 'neutral', style, textStyle, ...props }: Omit<PressableProps, 'style'> & {
  label: string;
  selected?: boolean;
  tone?: ChipTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...props}
      style={({ pressed }) => [styles.chip, styles[`chip_${tone}`], selected && styles.chipSelected, selected && styles[`chipSelected_${tone}`], pressed && styles.pressed, style]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function TacoCard({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>{children}</Pressable>;
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function TacoInput({ style, ...props }: TextInputProps) {
  return <TextInput placeholderTextColor={colors.textTertiary} {...props} style={[styles.input, style]} />;
}

export function MetricTile({ value, label, accent = false, icon, style }: { value: string | number; label: string; accent?: boolean; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.metric, style]}>{icon ? <Ionicons name={icon} size={16} color={colors.tortilla} /> : null}<Text style={[styles.metricValue, icon && styles.metricValueWithIcon, accent && styles.metricValueAccent]}>{value}</Text><Text style={styles.metricLabel}>{label.toUpperCase()}</Text></View>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <View style={styles.brandLockup}><TacoLogo size={compact ? 28 : 36} /><Text style={[styles.brand, compact && styles.brandCompact]}>tacos<Text style={styles.brandDot}>.</Text></Text></View>;
}

export function TacoLogo({ size = 36, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return <Image accessibilityLabel="Logo de tacos" source={require('../assets/taco-logo.png')} resizeMode="contain" style={[{ width: size, height: size }, style]} />;
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radii.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  button_primary: { backgroundColor: colors.tortilla },
  button_secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  button_quiet: { backgroundColor: 'transparent', paddingHorizontal: spacing.md },
  button_danger: { backgroundColor: colors.salsaSoft, borderWidth: 1, borderColor: colors.salsaBorder },
  buttonText: { fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  buttonText_primary: { color: colors.meatDark },
  buttonText_secondary: { color: colors.textPrimary },
  buttonText_quiet: { color: colors.textSecondary },
  buttonText_danger: { color: colors.salsa },
  chip: { borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chip_neutral: {},
  chip_success: { borderColor: colors.cilantroSoft },
  chip_salsa: { borderColor: colors.salsaBorder },
  chipSelected: { borderColor: colors.tortilla, backgroundColor: colors.tortilla },
  chipSelected_neutral: {},
  chipSelected_success: { backgroundColor: colors.cilantro, borderColor: colors.cilantro },
  chipSelected_salsa: { backgroundColor: colors.salsa, borderColor: colors.salsa },
  chipText: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.caption, fontWeight: typography.weight.medium },
  chipTextSelected: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, ...shadows.card },
  input: { minHeight: 52, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.md, paddingVertical: 12 },
  metric: { flex: 1, minHeight: 76, justifyContent: 'center' },
  metricValue: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 25, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.tight },
  metricValueWithIcon: { marginTop: 6 },
  metricValueAccent: { color: colors.tortilla },
  metricLabel: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.label, marginTop: 4 },
  brand: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 34, fontWeight: typography.weight.bold, letterSpacing: -1.8 },
  brandCompact: { fontSize: 27, fontFamily: typography.fontFamily.regular, letterSpacing: -1.2 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { color: colors.cilantroLight },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 }
});
