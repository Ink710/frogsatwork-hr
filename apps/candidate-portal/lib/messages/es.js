// Spanish dictionary for the candidate portal. Keys must mirror en.js exactly.
const es = {
  // Shell del sitio
  "site.name": "FrogsAtWork",
  "site.tagline": "Vacantes abiertas",
  "nav.roles": "Vacantes",

  // Listado de vacantes (la puerta de entrada)
  "careers.title": "Vacantes abiertas",
  "careers.subtitle": "Únete a nosotros — esto es lo que buscamos ahora mismo.",
  "careers.empty": "No hay vacantes abiertas por ahora. Vuelve pronto.",
  "careers.posted": "Publicada el {date}",
  "careers.view": "Ver vacante →",
  "careers.back": "← Todas las vacantes",

  // Detalle de la vacante
  "job.apply": "Postular a esta vacante",
  "job.applyHint": "Las postulaciones se gestionan en nuestro sitio de empleo.",

  // Inicio de sesión (M4) — sin contraseña, enlace de un solo uso
  "signin.title": "Iniciar sesión",
  "signin.subtitle": "Escribe el correo con el que postulaste y te enviamos un enlace. Sin contraseña.",
  "signin.email": "Correo",
  "signin.submit": "Enviarme un enlace",
  "signin.sending": "Enviando…",
  "signin.invalidEmail": "Escribe un correo válido.",
  "signin.sentTitle": "Revisa tu correo",
  "signin.sentBody":
    "Si tenemos una postulación con ese correo, el enlace de acceso va en camino.",
  "signin.sentHint": "El enlace sirve una sola vez y caduca en 30 minutos.",
  "signin.invalidTitle": "Ese enlace no funcionó",
  "signin.invalidBody":
    "Los enlaces sirven una sola vez y caducan a los 30 minutos. Pide uno nuevo y funcionará.",
  "signin.requestAnother": "Pedir un enlace nuevo →",

  // El portal privado
  "portal.title": "Tus postulaciones",
  "portal.subtitle": "En qué punto está cada una de tus postulaciones.",
  "portal.empty": "Ahora mismo no tenemos ninguna postulación tuya registrada.",
  "portal.appliedOn": "Postulaste el {date}",
  "portal.signOut": "Cerrar sesión",
  "portal.closingMessage":
    "Gracias por tu postulación. Tras revisar tu perfil, hemos decidido no continuar con tu candidatura para esta vacante. Agradecemos tu interés y te animamos a postular a futuras oportunidades.",

  // Nombres de las etapas visibles para la persona candidata. ⚠️ Son copy PÚBLICO.
  "enum.applicantStage.APPLIED": "Postulaste",
  "enum.applicantStage.SCREEN": "Preselección",
  "enum.applicantStage.INTERVIEW": "Entrevista",
  "enum.applicantStage.OFFER": "Oferta",
  "enum.applicantStage.HIRED": "Contratado/a",
  "enum.applicantStage.REJECTED": "No seleccionado/a",
  "enum.applicantStage.WITHDRAWN": "Retirada",
  "enum.applicantStage.UNKNOWN": "En curso",

  // Errores
  "error.title": "Algo salió mal",
  "error.generic": "Ocurrió un error inesperado. Inténtalo de nuevo.",
  "error.tryAgain": "Reintentar",
  "notFound.title": "No encontrado",
  "notFound.body": "Esa vacante ya no está abierta, o el enlace es incorrecto.",
  "notFound.back": "← Volver a las vacantes",

  // Enums visibles en una publicación pública
  "enum.employmentType.FULL_TIME": "Tiempo completo",
  "enum.employmentType.PART_TIME": "Medio tiempo",
  "enum.employmentType.CONTRACT": "Contrato",
  "enum.employmentType.INTERN": "Prácticas",
  "enum.payBasis.PER_HOUR": "por hora",
  "enum.payBasis.PER_MONTH": "al mes",
  "enum.payBasis.PER_YEAR": "al año",
};

export default es;
