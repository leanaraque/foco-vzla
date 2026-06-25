// i18n mínimo (Spec §6.5 "bilingüe-ready"): español por defecto, estructura
// preparada para añadir idiomas sin librería pesada. Para añadir 'en', basta con
// otro diccionario y un selector.
import { writable, derived } from 'svelte/store';

const diccionarios = {
  es: {
    'app.nombre': 'FOCO',
    'app.tagline': 'Ayuda mutua entre vecinos',

    // Reencuadre §9-2 / §22.7-1: ayuda mutua, NO rescate; nadie garantiza acudir.
    'banner.aviso': 'FOCO es ayuda mutua entre vecinos, no un servicio de rescate: nadie garantiza que alguien acuda. Ante peligro inmediato, contacta a las líneas oficiales.',
    'banner.oficiales': 'Líneas oficiales',

    'nav.mapa': 'Mapa',
    'nav.reportar': 'Reportar',
    'nav.panel': 'Panel',
    'nav.recursos': 'Recursos',

    // Microcopy: una línea por segmento (§22.7-6)
    'intro.mapa': 'Mira las necesidades de tu zona y confirma las que sean reales. Entre vecinos nos validamos y nos ayudamos.',
    'intro.reportar': 'Reporta una necesidad tuya o de alguien cerca, en menos de un minuto. No promete rescate: la ven otros vecinos.',
    'intro.panel': 'Acceso para coordinadores verificados. ¿Coordinas ayuda? Postúlate abajo.',
    'intro.recursos': 'Ofrece lo que tengas (agua, transporte, refugio…) para que un vecino lo encuentre.',

    // Vista pública del mapa (§22.7-2)
    'mapa.titulo': 'Necesidades cerca de ti',
    'mapa.lista': 'Lista',
    'mapa.mapa': 'Mapa',
    'mapa.actualizar': 'Actualizar',
    'mapa.actualizando': 'Actualizando…',
    'mapa.desde_cache': 'Mostrando datos guardados. Pulsa Actualizar para lo último.',
    'mapa.vacio': 'No hay necesidades para mostrar todavía.',
    'mapa.sector_aviso': 'Ubicación aproximada a nivel de sector para proteger a las personas.',
    'mapa.confirmar': 'Confirmar que esto es real',
    'mapa.confirmando': 'Confirmando…',
    'mapa.ya_confirmaste': 'Ya confirmaste esta necesidad. Gracias.',
    'mapa.confirmaciones': 'confirmaciones',
    'mapa.como_ayudar': '¿Cómo ayudar?',
    'mapa.como_ayudar_texto': 'Si puedes acercarte o aportar lo que se pide, hazlo con cuidado y en coordinación con otros vecinos. FOCO no organiza el rescate ni garantiza respuesta.',
    'mapa.cerrar': 'Cerrar',
    'mapa.revisar': 'Caso prioritario — pendiente de revisión del operador',

    'verif.confirmada': 'Confirmada por vecinos',
    'verif.pendiente_revision': 'Prioritario · por revisar',

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
    'reportar.ubicacion_ayuda': 'Elegir un lugar de la lista lo ubica en el mapa. El GPS da ubicación precisa y privada.',
    'reportar.ubicacion_ph': 'Escribe un sector, plaza, hospital…',
    'reportar.lugar_elegido': 'Lugar elegido',
    'reportar.quitar_lugar': 'Quitar lugar elegido',
    'reportar.sin_coincidencias': 'Sin coincidencias. Puedes escribir la referencia a mano.',
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

    'coordform.titulo': '¿Coordinas ayuda? Postúlate',
    'coordform.intro': 'Si organizas ayuda con una brigada, ONG o grupo vecinal, cuéntanos y te habilitamos como coordinador verificado.',
    'coordform.nombre': 'Nombre',
    'coordform.org': 'Organización o grupo',
    'coordform.zona': 'Zona donde operas',
    'coordform.contacto': 'Contacto (correo o teléfono)',
    'coordform.motivo': '¿Cómo ayudas? (breve)',
    'coordform.enviar': 'Enviar postulación',
    'coordform.enviando': 'Enviando…',
    'coordform.ok': '¡Gracias! Recibimos tu postulación y te contactaremos.',
    'coordform.error': 'No se pudo enviar. Intenta de nuevo en un momento.',
    'coordform.faltan': 'Completa al menos nombre, zona y contacto.',
    'coordform.espera': 'Espera un momento antes de enviar otra vez.',

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
