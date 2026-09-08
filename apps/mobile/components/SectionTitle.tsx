import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/theme';

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: string }) {
  return (
    <View style={styles.row}>
      <View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {action ? <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginBottom: 5 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.7 },
  action: { color: colors.muted, fontSize: 12, fontWeight: '700', paddingBottom: 3 }
});
