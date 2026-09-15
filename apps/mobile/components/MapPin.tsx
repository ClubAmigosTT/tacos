import { StyleSheet, Text, View } from 'react-native';
import { memo } from 'react';
import { colors, typography } from '@/theme';

export const MapPin = memo(function MapPin({ label, accent = false, variant }: { label: string; accent?: boolean; variant?: 'default' | 'visited' | 'saved' | 'match' }) {
  const tone = variant ?? (accent ? 'match' : 'default');
  return <View style={[styles.pin, styles[`pin_${tone}`]]}><Text style={[styles.text, styles[`text_${tone}`]]}>{label}</Text></View>;
});

const styles = StyleSheet.create({
  pin: { minWidth: 46, height: 34, borderRadius: 18, paddingHorizontal: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pin_default: { backgroundColor: colors.tortilla, borderColor: colors.meatDark },
  pin_visited: { backgroundColor: colors.cilantro, borderColor: colors.meatDark },
  pin_saved: { backgroundColor: colors.salsa, borderColor: colors.meatDark },
  pin_match: { backgroundColor: colors.cilantroLight, borderColor: colors.meatDark },
  text: { fontFamily: typography.fontFamily.bold, fontSize: 12, fontWeight: typography.weight.bold },
  text_default: { color: colors.meatDark },
  text_visited: { color: colors.textPrimary },
  text_saved: { color: colors.meatDark },
  text_match: { color: colors.meatDark }
});
