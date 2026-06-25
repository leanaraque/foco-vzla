// i18n mínimo (Spec §6.5 "bilingüe-ready"): español por defecto, estructura
// preparada para añadir idiomas sin librería pesada. Para añadir 'en', basta con
// otro diccionario y un selector.
import { writable, derived } from 'svelte/store';

const diccionarios = {
  es: {
    'app.nombre': 'FOCO',
    'app.tagline': 'Coordinación de ayuda ciudadana',

    'banner.aviso': 'Esto coordina ayuda ciudadana; no es un servicio de emergencia. Ante peligro inmediato, contacte a las líneas oficiales.',
    'banner.oficiales': 'Líneas oficiales',

    'nav.reportar': 'Reportar',
    'nav.panel': 'Panel',
    'nav.recursos': 'Recursos',

    'cat.rescate': 'Rescate',
    'cat.medico': 'Médico',
    'cat.agua': 'Agua',
    'cat.alimento': 'Alimento',
    'cat.refugio': 'Refugio',
    'cat.transporte': 'Transporte',
    'cat.otro': 'Otro',

    'urg.critica': 'Crítica',
    'urg.alta': 'Alta',
    'urg.media': 'Media',

    'estado.sin_atender': 'Sin atender',
    'estado.asignada': 'Asignada',
    'estado.resuelta': 'Resuelta',
    'estado.cerrada_invalida': 'Cerrada (inválida)',

    'verif.no_verificada': 'Sin verificar',
    'verif.verificada': 'Verificada',

    'reportar.titulo': 'Reportar una necesidad',
    'reportar.categoria': '¿Qué se necesita?',
    'reportar.urgencia': 'Urgencia',
    'reportar.ubicacion': 'Ubicación (sector / referencia)',
    'reportar.usar_gps': 'Usar mi ubicación',
    'reportar.descripcion': 'Detalle breve',
    'reportar.descripcion_aviso': '⚠️ No escribas datos personales (nombres completos, cédula, dirección exacta): la descripción se hace pública al verificarse. Para que te contacten, usa el campo de contacto — ese sí es privado.',
    'reportar.contacto': 'Contacto (opcional, privado)',
    'reportar.contacto_ayuda': 'Solo lo verá un coordinador que tome el caso. Nunca es público.',
    'reportar.enviar': 'Enviar reporte',
    'reportar.enviando': 'Enviando…',
    'reportar.ok': 'Reporte recibido. Gracias.',
    'reportar.ok_offline': 'Guardado sin conexión. Se enviará al recuperar señal.',
    'reportar.otro': 'Reportar otra necesidad',
    'reportar.falta_ubicacion': 'Indica una ubicación o usa el GPS.',

    'panel.titulo': 'Panel de coordinación',
    'panel.lista': 'Lista',
    'panel.mapa': 'Mapa',
    'panel.filtros': 'Filtros',
    'panel.ver_no_verificadas': 'Ver también sin verificar',
    'panel.todas_categorias': 'Todas las categorías',
    'panel.todas_urgencias': 'Toda urgencia',
    'panel.vacio': 'No hay necesidades con estos filtros.',
    'panel.cargar_mas': 'Cargar más',

    'accion.reclamar': 'Yo me encargo',
    'accion.resolver': 'Marcar resuelta',
    'accion.reabrir': 'Reabrir',
    'accion.verificar': 'Verificar',
    'accion.invalidar': 'Marcar inválida',
    'accion.ver_contacto': 'Ver contacto',
    'reclamada_por': 'A cargo de',

    'recursos.titulo': 'Recursos disponibles',
    'recursos.registrar': 'Registrar un recurso',
    'recursos.vacio': 'Aún no hay recursos registrados.',
    'recursos.disponible': 'Disponible',

    'auth.coord_titulo': 'Acceso de coordinador',
    'auth.email': 'Correo',
    'auth.password': 'Contraseña',
    'auth.entrar': 'Entrar',
    'auth.salir': 'Salir',
    'auth.error': 'No se pudo iniciar sesión. Revisa tus datos.',
    'auth.no_coord': 'Tu cuenta aún no está habilitada como coordinador verificado.',

    'comun.cancelar': 'Cancelar',
    'comun.guardar': 'Guardar',
    'comun.cerrar': 'Cerrar',
    'comun.error': 'Ocurrió un error. Intenta de nuevo.',
    'comun.sin_conexion': 'Sin conexión',
    'comun.opcional': 'opcional'
  }
};

export const locale = writable('es');

export const t = derived(locale, ($locale) => {
  const dic = diccionarios[$locale] || diccionarios.es;
  return (clave) => dic[clave] ?? clave;
});

// Líneas oficiales (Spec §5). Ajustar a los números vigentes durante la operación.
export const lineasOficiales = [
  { nombre: 'Protección Civil', detalle: '0800-PCIVIL / 171' },
  { nombre: 'Bomberos', detalle: '171' },
  { nombre: 'Funvisis (sismología)', detalle: 'funvisis.gob.ve' }
];
