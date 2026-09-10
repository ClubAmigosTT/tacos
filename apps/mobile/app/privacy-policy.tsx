import { Text } from 'react-native';
import { PublicInfoPage } from '@/components/PublicInfoPage';
import { colors } from '@/theme';

const LinkText = ({ children }: { children: string }) => <Text style={{ color: colors.accent, fontWeight: '800' }}>{children}</Text>;

export default function PrivacyPolicyScreen() {
  return <PublicInfoPage eyebrow="VIGENTE DESDE EL 10 DE SEPTIEMBRE DE 2026" title="Política de privacidad" intro="Tacos es una comunidad para descubrir, registrar y compartir experiencias gastronómicas. Esta política explica qué datos tratamos y qué control tienes sobre ellos." sections={[
    { title: 'Datos que utilizamos', body: 'Al crear una cuenta recibimos tu correo, nombre público y una contraseña protegida mediante hash. Si decides participar, guardamos visitas, calificaciones, comentarios, listas, lugares guardados, relaciones sociales y fotografías que subas. También registramos eventos técnicos básicos para operar y mejorar el servicio.' },
    { title: 'Ubicación y fotografías', body: 'La ubicación precisa se solicita solo mientras usas la app para mostrar lugares cercanos y facilitar el registro de una visita; no mantenemos un rastreo continuo. Las fotografías y el acceso a la cámara son opcionales y solo se usan cuando eliges adjuntar una imagen.' },
    { title: 'Cómo usamos la información', body: 'Usamos estos datos para autenticar tu cuenta, sincronizar tu diario, mostrar recomendaciones, calcular afinidad, habilitar funciones sociales, prevenir abuso, atender solicitudes y mantener la seguridad y confiabilidad de Tacos.' },
    { title: 'Información pública y controles', body: 'Tu nombre público, reseñas, listas públicas y actividad compartida pueden ser visibles para otras personas. Puedes ocultar la actividad social desde Privacidad, exportar tus datos, revocar sesiones o eliminar tu cuenta desde Ajustes.' },
    { title: 'Proveedores', body: 'Usamos proveedores de infraestructura y entrega necesarios para operar el servicio, como Render, PostgreSQL/Neon, almacenamiento compatible con S3 o R2, Resend y los servicios cartográficos de Apple o Google según la plataforma. No vendemos tus datos ni los usamos para publicidad de terceros.' },
    { title: 'Conservación y eliminación', body: 'Conservamos tus datos mientras tu cuenta esté activa y el tiempo necesario para seguridad y obligaciones legales. Al eliminar la cuenta borramos tu perfil, credenciales, listas, guardados y sesiones. Las aportaciones que ya sean públicas pueden conservarse de forma desvinculada para mantener la integridad del catálogo.' },
    { title: 'Contacto', body: <>Para preguntas de privacidad, acceso o eliminación escribe a <LinkText>hola@clubamigostt.com</LinkText>. Respondemos desde Ciudad de México, México.</> }
  ]} />;
}

