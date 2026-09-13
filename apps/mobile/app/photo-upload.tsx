import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ApiError, submitBranchPhoto } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

type SelectedPhoto = { uri: string; base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' };

export default function PhotoUploadScreen() {
  const { branchId, placeName } = useLocalSearchParams<{ branchId?: string; placeName?: string }>();
  const { token, loading: authLoading } = useAuth();
  const [photo, setPhoto] = useState<SelectedPhoto>();
  const [sourceType, setSourceType] = useState<'community' | 'owner'>('community');
  const [consentGranted, setConsentGranted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const name = typeof placeName === 'string' && placeName.trim() ? placeName : 'esta taquería';

  async function choosePhoto(source: 'camera' | 'library') {
    try {
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.82, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.82, base64: true });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset?.base64) {
        if (!result.canceled) setError('No pudimos leer esa foto. Prueba con otra imagen.');
        return;
      }
      const contentType = asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
      setPhoto({ uri: asset.uri, base64: asset.base64, contentType });
      setError('');
    } catch {
      setError('No pudimos abrir la cámara o galería.');
    }
  }

  async function submit() {
    if (!branchId || !token || !photo) {
      setError('Elige una foto para continuar.');
      return;
    }
    if (!consentGranted) {
      setError('Confirma que tienes permiso para compartir esta imagen.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await submitBranchPhoto(branchId, { ...photo, sourceType, consentGranted: true }, token);
      setSubmitted(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 503) setError('El almacenamiento de fotos aún no está configurado. La visita y tus calificaciones siguen funcionando.');
      else if (cause instanceof ApiError && cause.status === 413) setError('La imagen es demasiado grande. Elige una foto más ligera.');
      else if (cause instanceof ApiError && cause.status === 409) setError('Esta sucursal ya alcanzó el límite de fotos pendientes o aprobadas.');
      else if (cause instanceof ApiError && cause.status === 429) setError('Ya enviaste varias fotos recientemente. Inténtalo mañana.');
      else setError('No pudimos enviar la foto. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Preparando la subida…</Text></View>;
  if (!token) return <View style={styles.center}><Ionicons name="camera-outline" size={32} color={colors.tortilla} /><Text style={styles.title}>Entra para agregar una foto</Text><Text style={styles.muted}>Las fotos se asocian a tu cuenta y pasan por revisión antes de aparecer en la ficha.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/photo-upload', branchId, placeName } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text><Ionicons name="arrow-forward" size={17} color={colors.meatDark} /></Pressable><Pressable style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Volver</Text></Pressable></View>;
  if (submitted) return <View style={styles.center}><View style={styles.successIcon}><Ionicons name="checkmark" size={30} color={colors.meatDark} /></View><Text style={styles.title}>Foto enviada</Text><Text style={styles.muted}>La revisaremos antes de mostrarla públicamente en {name}.</Text><Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Volver a la taquería</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CONTRIBUYE AL CATÁLOGO</Text><Text style={styles.headerTitle}>Agregar foto</Text></View><Ionicons name="images-outline" size={21} color={colors.tortilla} /></View><Text style={styles.title}>Una foto hace que el lugar se sienta real.</Text><Text style={styles.intro}>Sube una imagen de {name}. No uses fotos de Google u otros sitios: comparte una foto propia o autorizada.</Text>{photo ? <View style={styles.previewWrap}><Image source={{ uri: photo.uri }} style={styles.preview} /><Pressable style={styles.remove} onPress={() => setPhoto(undefined)}><Ionicons name="close" size={15} color={colors.textPrimary} /><Text style={styles.removeText}>Cambiar foto</Text></Pressable></View> : <View style={styles.buttons}><Pressable style={styles.photoButton} onPress={() => void choosePhoto('camera')}><Ionicons name="camera-outline" size={20} color={colors.tortilla} /><Text style={styles.photoButtonText}>Cámara</Text></Pressable><Pressable style={styles.photoButton} onPress={() => void choosePhoto('library')}><Ionicons name="images-outline" size={20} color={colors.tortilla} /><Text style={styles.photoButtonText}>Galería</Text></Pressable></View>}<Text style={styles.label}>¿DE DÓNDE VIENE LA FOTO?</Text><View style={styles.sourceRow}><Pressable style={[styles.sourceOption, sourceType === 'community' && styles.sourceOptionActive]} onPress={() => setSourceType('community')}><Ionicons name="person-outline" size={18} color={sourceType === 'community' ? colors.meatDark : colors.tortilla} /><View style={styles.sourceCopy}><Text style={[styles.sourceTitle, sourceType === 'community' && styles.sourceTextActive]}>Comunidad</Text><Text style={[styles.sourceDetail, sourceType === 'community' && styles.sourceTextActive]}>La tomé o tengo permiso</Text></View></Pressable><Pressable style={[styles.sourceOption, sourceType === 'owner' && styles.sourceOptionActive]} onPress={() => setSourceType('owner')}><Ionicons name="storefront-outline" size={18} color={sourceType === 'owner' ? colors.meatDark : colors.tortilla} /><View style={styles.sourceCopy}><Text style={[styles.sourceTitle, sourceType === 'owner' && styles.sourceTextActive]}>Negocio</Text><Text style={[styles.sourceDetail, sourceType === 'owner' && styles.sourceTextActive]}>Represento este lugar</Text></View></Pressable></View><Pressable style={styles.consentRow} onPress={() => setConsentGranted((current) => !current)} accessibilityRole="checkbox" accessibilityState={{ checked: consentGranted }}><View style={[styles.checkbox, consentGranted && styles.checkboxActive]}>{consentGranted ? <Ionicons name="checkmark" size={15} color={colors.meatDark} /> : null}</View><Text style={styles.consentText}>Confirmo que tengo permiso para compartir esta imagen y autorizo a Tacos a mostrarla en la ficha del lugar.</Text></Pressable>{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}<Pressable style={[styles.primary, (!photo || !consentGranted || saving) && styles.disabled]} disabled={!photo || !consentGranted || saving} onPress={() => void submit()}><Text style={styles.primaryText}>{saving ? 'Enviando…' : 'Enviar para revisión'}</Text><Ionicons name="arrow-forward" size={17} color={colors.meatDark} /></Pressable></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 70 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerCopy: { alignItems: 'center' },
  eyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.bold, fontSize: 9, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  headerTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 21, fontWeight: typography.weight.bold, marginTop: 3 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 27, fontWeight: typography.weight.bold, lineHeight: 32, textAlign: 'center' },
  intro: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9, marginBottom: spacing.xl },
  buttons: { flexDirection: 'row', gap: 9 },
  photoButton: { flex: 1, minHeight: 92, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoButtonText: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  previewWrap: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surface },
  preview: { width: '100%', height: 250, backgroundColor: colors.surfaceRaised },
  remove: { minHeight: 42, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  removeText: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  label: { color: colors.textTertiary, fontFamily: typography.fontFamily.bold, fontSize: 9, fontWeight: typography.weight.bold, letterSpacing: 1.3, marginTop: spacing.xl, marginBottom: 9 },
  sourceRow: { gap: 8 },
  sourceOption: { minHeight: 62, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceOptionActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  sourceCopy: { flex: 1 },
  sourceTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  sourceDetail: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, marginTop: 2 },
  sourceTextActive: { color: colors.meatDark },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: spacing.lg },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  consentText: { flex: 1, color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, lineHeight: 17 },
  error: { color: colors.danger, fontFamily: typography.fontFamily.medium, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  primary: { minHeight: 53, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: spacing.xl },
  primaryText: { color: colors.meatDark, fontFamily: typography.fontFamily.bold, fontSize: 13, fontWeight: typography.weight.bold },
  disabled: { opacity: 0.4 },
  successIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  muted: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 320 },
  cancel: { marginTop: spacing.lg, padding: 8 },
  cancelText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium }
});
