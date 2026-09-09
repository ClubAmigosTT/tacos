import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/theme';

export function AsyncErrorState({
  title,
  detail,
  action = 'Intentar de nuevo',
  onAction
}: {
  title: string;
  detail: string;
  action?: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.icon}><Ionicons name="cloud-offline-outline" size={25} color={colors.background} /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <Pressable style={styles.button} onPress={onAction}>
        <Text style={styles.buttonText}>{action}</Text>
        <Ionicons name="refresh-outline" size={16} color={colors.background} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 },
  button: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 48, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.lg },
  buttonText: { color: colors.background, fontSize: 13, fontWeight: '900' }
});
