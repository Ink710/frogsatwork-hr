// Spanish dictionary for the ATS (recruiting) app. Mirrors en.js key-for-key.
const es = {
  "brand.slogan": "Saltemos a ello.",

  // Nav / shell
  "nav.home": "Vacantes",
  "nav.jobs": "Vacantes",
  "nav.preferences": "Preferencias",
  "nav.signOut": "Cerrar sesión",

  // Roles
  "enum.role.EMPLOYEE": "Empleado",
  "enum.role.MANAGER": "Gerente",
  "enum.role.HR_GENERALIST": "Generalista de RR. HH.",
  "enum.role.HR_ADMIN": "Administrador de RR. HH.",
  "enum.role.PAYROLL_ADMIN": "Administrador de Nómina",
  "enum.role.RECRUITER": "Reclutador",
  "enum.role.SYSTEM": "Sistema",

  // Login
  "login.title": "Iniciar sesión",
  "login.email": "Correo electrónico",
  "login.password": "Contraseña",
  "login.submit": "Iniciar sesión",
  "login.invalid": "Correo o contraseña no válidos.",
  "login.rateLimited": "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
  "login.activated": "Tu cuenta está lista — inicia sesión para continuar.",
  "login.seededHint": "Cuentas de demostración (contraseña: password123)",

  // Preferences
  "prefs.title": "Preferencias",
  "prefs.subtitle": "Personaliza cómo se ve y se lee la app para ti.",
  "prefs.appearance": "Apariencia",
  "prefs.appearanceHelp": "Elige un tema o sigue tu dispositivo.",
  "prefs.language": "Idioma",
  "prefs.languageHelp": "Cambia el idioma de la interfaz.",
  "prefs.theme.light": "Claro",
  "prefs.theme.lightHint": "Siempre claro.",
  "prefs.theme.dark": "Oscuro",
  "prefs.theme.darkHint": "Siempre oscuro.",
  "prefs.theme.system": "Sistema",
  "prefs.theme.systemHint": "Sigue tu dispositivo.",

  // Error / not-found
  "error.title": "Algo salió mal",
  "error.generic": "Ocurrió un error inesperado. Inténtalo de nuevo.",
  "error.tryAgain": "Reintentar",
  "notFound.title": "No encontrado",
  "notFound.body": "Esa página no existe o no tienes acceso.",
  "notFound.back": "← Volver a Vacantes",

  // Jobs list
  "jobs.title": "Vacantes",
  "jobs.subtitle": "Vacantes en las que participas. Abre una para ver su flujo.",
  "jobs.empty": "Aún no estás en ningún equipo de contratación.",
  "jobs.openings": "{n} vacante(s)",
  "jobs.applications": "{n} en flujo",
  "jobs.viewBoard": "Ver flujo →",

  // Pipeline board
  "board.back": "← Todas las vacantes",
  "board.pipeline": "Flujo",
  "board.emptyColumn": "Ninguno",
  "board.closed": "Cerrados",
  "board.round": "Ronda",
  "board.readOnly": "Tienes acceso de solo lectura a este flujo.",
  "board.appliedOn": "Postuló el {date}",
  "board.source": "Origen: {source}",
  "board.viewCandidate": "Ver →",

  // Move actions
  "action.advance": "Avanzar",
  "action.advanceTo": "Avanzar a {stage}",
  "action.reject": "Rechazar",
  "action.withdraw": "Retirar",
  "action.nextRound": "Siguiente ronda",
  "action.advanceToOffer": "Avanzar a Oferta",

  // Application detail
  "app.title": "Candidato",
  "app.timeline": "Historial del flujo",
  "app.appliedOn": "Postuló el {date}",
  "app.appliedLabel": "Fecha de postulación",
  "app.source": "Origen",
  "app.phone": "Teléfono",
  "app.email": "Correo",
  "app.currentStage": "Etapa actual",
  "app.currentRound": "Ronda actual",
  "app.event.moved": "{from} → {to}",
  "app.event.applied": "Postulación",
  "app.event.round": "Ronda de entrevista: {round}",

  // Stages
  "enum.applicationStage.APPLIED": "Postulado",
  "enum.applicationStage.SCREEN": "Filtro",
  "enum.applicationStage.INTERVIEW": "Entrevista",
  "enum.applicationStage.OFFER": "Oferta",
  "enum.applicationStage.HIRED": "Contratado",
  "enum.applicationStage.REJECTED": "Rechazado",
  "enum.applicationStage.WITHDRAWN": "Retirado",

  // Job status
  "enum.jobStatus.DRAFT": "Borrador",
  "enum.jobStatus.OPEN": "Abierta",
  "enum.jobStatus.PAUSED": "Pausada",
  "enum.jobStatus.CLOSED": "Cerrada",
  "enum.jobStatus.FILLED": "Cubierta",

  // Errors
  "err.notAuthorized": "No puedes gestionar el flujo de esta vacante.",
  "err.applicationNotFound": "Postulación no encontrada.",
  "err.invalidTransition": "Ese no es un movimiento válido para esta etapa.",
  "err.notInterview": "Esta postulación no está en la etapa de entrevista.",
  "err.atLastRound": "Ya está en la última ronda — avanza a Oferta.",
  "err.invalidInput": "Revisa el formulario e inténtalo de nuevo.",
  "err.moveFailed": "No se pudo actualizar la postulación. Inténtalo de nuevo.",
};

export default es;
