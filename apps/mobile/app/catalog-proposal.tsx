import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, createCatalogProposal, getPlace } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';

const correctionFields = [
  ['address', 'Dirección'],
  ['phone', 'Teléfono'],
  ['openUntil', 'Hora de cierre'],
  ['description', 'Descripción']
] as const;

type ProposalKind = 'branch' | 'menu_item' | 'correction';

export default function CatalogProposalScreen() {
  const { token, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ branchId?: string; kind?: string }>();
  const kind: ProposalKind = params.kind === 'branch' || params.kind === 'menu_item' || params.kind === 'correction' ? params.kind : 'branch';
  const branchId = typeof params.branchId === 'string' ? params.branchId : undefined;
  const { data: place } = useQuery({ queryKey: ['place', 'proposal', branchId], queryFn: () => getPlace(branchId!), enabled: Boolean(branchId) });
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [style, setStyle] = useState('');
  const [tacoNote, setTacoNote] = useState('');
  const [price, setPrice] = useState('');
  const [correctionField, setCorrectionField] = useState<(typeof correctionFields)[number][0]>('address');
  const [correctionValue, setCorrectionValue] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (place && kind === 'correction') {
      setCorrectionValue(correctionField === 'address' ? place.address ?? '' : correctionField === 'phone' ? place.phone ?? '' : correctionField === 'openUntil' ? place.openUntil : correctionField === 'description' ? place.description : '');
    }
  }, [correctionField, kind, place]);

  useEffect(() => {
    if (kind !== 'branch' || Platform.OS === 'web' || latitude || longitude) return;
    let active = true;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) return;
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) {
          setLatitude(current.coords.latitude.toFixed(6));
          setLongitude(current.coords.longitude.toFixed(6));
        }
      } catch { /* Coordinates can also be entered manually. */ }
    })();
    return () => { active = false; };
  }, [kind]);

  const title = useMemo(() => kind === 'branch' ? 'Agregar una taquería' : kind === 'menu_item' ? 'Proponer un taco' : 'Corregir información', [kind]);
  const mutation = useMutation({
    mutationFn: () => {
      if (!token) throw new Error('UNAUTHORIZED');
      const evidence = evidenceUrl.trim();
      if (evidence && !evidence.startsWith('https://')) throw new Error('La evidencia debe empezar con https://');
      if (kind === 'branch') {
        const lat = Number(latitude.replace(',', '.'));
        const lng = Number(longitude.replace(',', '.'));
        if (!name.trim() || !neighborhood.trim() || !address.trim()) throw new Error('Completa nombre, colonia y dirección.');
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Agrega coordenadas válidas o permite usar tu ubicación.');
        return createCatalogProposal({ kind, payload: { name: name.trim(), neighborhood: neighborhood.trim(), address: address.trim(), phone: phone.trim(), latitude: lat, longitude: lng, style: style.trim() || 'Clásico callejero', taqueriaName: name.trim() }, ...(evidence ? { evidenceUrl: evidence } : {}) }, token);
      }
      if (kind === 'menu_item') {
        const parsedPrice = price.trim() ? Number(price.replace(',', '.')) : 0;
        if (!branchId || !name.trim()) throw new Error('Completa el nombre del taco.');
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 100000) throw new Error('El precio debe ser un número válido.');
        return createCatalogProposal({ kind, branchId, payload: { name: name.trim(), note: tacoNote.trim(), price: parsedPrice }, ...(evidence ? { evidenceUrl: evidence } : {}) }, token);
      }
      if (!branchId || !correctionValue.trim()) throw new Error('Completa el dato corregido.');
      return createCatalogProposal({ kind, branchId, payload: { changes: { [correctionField]: correctionValue.trim() } }, ...(evidence ? { evidenceUrl: evidence } : {}) }, token);
    },
    onSuccess: () => { setSent(true); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.status === 401 ? 'Tu sesión expiró. Entra de nuevo para enviar la propuesta.' : 'No pudimos enviar la propuesta. Revisa los datos e inténtalo de nuevo.' : cause instanceof Error ? cause.message : 'No pudimos enviar la propuesta. Inténtalo de nuevo.')
  });

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Preparando la propuesta…</Text></View>;
  if (!token) return <View style={styles.center}><View style={styles.icon}><Ionicons name="create-outline" size={24} color={colors.background} /></View><Text style={styles.title}>Ayúdanos a mantener el catálogo vivo</Text><Text style={styles.muted}>Entra para proponer una taquería, un taco o una corrección verificable.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/catalog-proposal', ...(branchId ? { branchId } : {}), kind } })}><Text style={styles.primaryText}>Entrar o crear cuenta</Text></Pressable></View>;
  if (sent) return <View style={styles.center}><View style={styles.successIcon}><Ionicons name="checkmark" size={30} color={colors.background} /></View><Text style={styles.title}>Propuesta enviada</Text><Text style={styles.muted}>La revisaremos antes de publicarla para que el catálogo conserve información confiable.</Text><Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Volver</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar propuesta" onPress={() => router.back()}><Ionicons name="close" size={25} color={colors.textPrimary} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>CATÁLOGO COMUNITARIO</Text><Text style={styles.headerTitle}>{title}</Text></View><Ionicons name="shield-checkmark-outline" size={21} color={colors.tortilla} /></View><Text style={styles.intro}>{kind === 'branch' ? 'Comparte un lugar que todavía no aparece. Necesitamos datos que el equipo pueda comprobar.' : kind === 'menu_item' ? `Añade un taco que sirvan en ${place?.name ?? 'esta sucursal'}.` : `Ayúdanos a corregir ${place?.name ?? 'esta sucursal'} con el dato exacto.`}</Text>{kind === 'branch' ? <><Field label="NOMBRE"><TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Ej. Tacos La Esquina" placeholderTextColor={colors.textTertiary} maxLength={100} /></Field><Field label="COLONIA"><TextInput value={neighborhood} onChangeText={setNeighborhood} style={styles.input} placeholder="Ej. Narvarte" placeholderTextColor={colors.textTertiary} maxLength={80} /></Field><Field label="DIRECCIÓN"><TextInput value={address} onChangeText={setAddress} style={styles.input} placeholder="Calle, número y referencias" placeholderTextColor={colors.textTertiary} maxLength={240} /></Field><Field label="TELÉFONO · OPCIONAL"><TextInput value={phone} onChangeText={setPhone} style={styles.input} placeholder="55 0000 0000" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" maxLength={30} /></Field><View style={styles.twoColumns}><Field label="LATITUD"><TextInput value={latitude} onChangeText={setLatitude} style={styles.input} placeholder="19.40" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" /></Field><Field label="LONGITUD"><TextInput value={longitude} onChangeText={setLongitude} style={styles.input} placeholder="-99.16" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" /></Field></View><Field label="ESTILO · OPCIONAL"><TextInput value={style} onChangeText={setStyle} style={styles.input} placeholder="Pastor nocturno" placeholderTextColor={colors.textTertiary} maxLength={80} /></Field></> : kind === 'menu_item' ? <><Field label="TACO"><TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Ej. Campechano" placeholderTextColor={colors.textTertiary} maxLength={80} /></Field><Field label="PRECIO · OPCIONAL"><TextInput value={price} onChangeText={setPrice} style={styles.input} placeholder="28" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" /></Field><Field label="NOTA · OPCIONAL"><TextInput value={tacoNote} onChangeText={setTacoNote} style={[styles.input, styles.textarea]} placeholder="Qué lo distingue" placeholderTextColor={colors.textTertiary} multiline maxLength={240} /></Field></> : <><Text style={styles.label}>DATO A CORREGIR</Text><View style={styles.options}>{correctionFields.map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: correctionField === value }} onPress={() => setCorrectionField(value)} style={[styles.option, correctionField === value && styles.optionActive]}><Text style={[styles.optionText, correctionField === value && styles.optionTextActive]}>{label}</Text></Pressable>)}</View><Field label="DATO CORRECTO"><TextInput value={correctionValue} onChangeText={setCorrectionValue} style={[styles.input, styles.textarea]} placeholder="Escribe el dato correcto" placeholderTextColor={colors.textTertiary} multiline={correctionField === 'description'} maxLength={500} /></Field></>}<Field label="EVIDENCIA · OPCIONAL"><TextInput value={evidenceUrl} onChangeText={setEvidenceUrl} style={styles.input} placeholder="https://…" placeholderTextColor={colors.textTertiary} autoCapitalize="none" keyboardType="url" maxLength={2000} /></Field><Text style={styles.note}>La propuesta queda pendiente hasta que una persona administradora revise los datos y la evidencia.</Text>{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" style={[styles.primary, mutation.isPending && styles.disabled]} disabled={mutation.isPending} onPress={() => { setError(''); mutation.mutate(); }}><Text style={styles.primaryText}>{mutation.isPending ? 'Enviando…' : 'Enviar propuesta'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable></ScrollView>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 100 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  headerCopy: { alignItems: 'center', flex: 1 },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.4 },
  headerTitle: { color: colors.textPrimary, fontSize: 21, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 4 },
  title: { color: colors.textPrimary, fontSize: 25, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, textAlign: 'center', marginTop: spacing.md },
  intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, fontFamily: typography.fontFamily.regular, marginBottom: spacing.lg },
  field: { marginBottom: spacing.md, flex: 1 },
  label: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.2, marginBottom: 7 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: 13, paddingVertical: 11, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 13 },
  textarea: { minHeight: 86, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface },
  optionActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  optionText: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.medium },
  optionTextActive: { color: colors.meatDark, fontFamily: typography.fontFamily.bold },
  note: { color: colors.textTertiary, fontSize: 11, lineHeight: 17, fontFamily: typography.fontFamily.regular, marginTop: spacing.sm },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, fontFamily: typography.fontFamily.medium, marginTop: spacing.md },
  primary: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  primaryText: { color: colors.meatDark, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  disabled: { opacity: 0.45 },
  icon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.cilantroLight, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: typography.fontFamily.regular, textAlign: 'center', marginTop: 8, maxWidth: 320 }
});
