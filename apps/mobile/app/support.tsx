import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { PublicInfoPage } from '@/components/PublicInfoPage';
import { colors, radii } from '@/theme';

export default function SupportScreen() {
  return <PublicInfoPage eyebrow="AYUDA Y SOPORTE" title="¿Cómo podemos ayudarte?" intro="Resolvemos problemas de acceso, datos, contenido y funcionamiento de Tacos." sections={[
    { title: 'Cuenta y acceso', body: 'Puedes verificar tu correo, recuperar tu contraseña y cerrar sesiones abiertas desde la pantalla de acceso y Ajustes. Si no recibes un correo, revisa spam y vuelve a solicitarlo después de unos minutos.' },
    { title: 'Tus datos', body: 'Desde Ajustes puedes exportar una copia JSON de tu cuenta y diario, cambiar la visibilidad de tu actividad o eliminar tu cuenta directamente dentro de la app.' },
    { title: 'Contenido y lugares', body: 'Si una taquería tiene datos incorrectos, encuentras contenido inapropiado o necesitas acreditar una fotografía, envíanos el nombre del lugar y una descripción del problema.' },
    { title: 'Contacto', body: <><Text>Escríbenos a </Text><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('mailto:hola@clubamigostt.com?subject=Soporte%20Tacos')} style={styles.button}><Text style={styles.buttonText}>hola@clubamigostt.com</Text></Pressable><Text>. Incluye el modelo de tu dispositivo y la versión de iOS o Android cuando reportes un error.</Text></> }
  ]} />;
}

const styles = StyleSheet.create({
  button: { borderRadius: radii.pill },
  buttonText: { color: colors.accent, fontWeight: '900' }
});

