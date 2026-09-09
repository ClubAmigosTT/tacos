import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';

export function MapPin({ label, accent = false }: { label: string; accent?: boolean }) {
  return <View style={[styles.pin, accent && styles.pinAccent]}><Text style={[styles.text, accent && styles.textAccent]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  text: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  textAccent: { color: colors.background }
});
