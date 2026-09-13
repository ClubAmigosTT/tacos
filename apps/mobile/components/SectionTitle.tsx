import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/theme';

export function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.row}>
      <View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {action ? onAction ? <Pressable accessibilityRole="button" accessibilityLabel={action.replace(/→/g, '').trim()} onPress={onAction} hitSlop={8}><Text style={styles.action}>{action}</Text></Pressable> : <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose, marginBottom: 6 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 23, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.tight },
  action: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.caption, fontWeight: typography.weight.medium, paddingBottom: 3 }
});
