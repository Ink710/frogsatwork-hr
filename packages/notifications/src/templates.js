// Candidate-facing email copy (M8).
//
// ⚠️ THIS IS THE ONE EXCEPTION TO "EACH APP OWNS THE WORDS IT SENDS" (see index.js), and it is a
// deliberate one. These messages are sent by TWO different apps to the SAME audience: the receipt
// fires from the candidate portal's apply flow *and* from the ATS careers fallback, and the
// stage-change messages fire from the ATS. Keeping the copy in each app's dictionary would mean two
// diverging versions of words a stranger reads. The original rule did not anticipate that case.
//
// Staff-facing copy is unaffected — employee-records still owns its own invite wording.
//
// ⚠️ NO REJECTION REASON, EVER. `Application.rejectionReason` is free text a recruiter wrote for
// colleagues and `rejectionCategory` is chosen in one click to feed /reports. M5 established that
// neither is ever surfaced to the applicant, and an email is a document they keep forever. The
// REJECTED copy below is M5's portal courtesy message, reused verbatim so the two channels cannot
// drift into saying different things about the same decision.

const FALLBACK_LOCALE = "en";

// Interpolated values come from the database: a job title a recruiter typed, and a first name the
// applicant set themselves through the profile editor. Escaping is cheap and the alternative is
// letting either one inject markup into a message we send.
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Subject + paragraphs per stage. Paragraphs are plain strings; the renderer below turns them into
// both a text and an HTML body, so no template is written twice.
const COPY = {
  en: {
    portalLink: "Track your application",
    signoff: "FrogsAtWorkHR",
    APPLIED: {
      subject: (job) => `We've received your application for ${job}`,
      paragraphs: (name, job) => [
        `Hi ${name},`,
        `Thanks for applying for ${job}. We've received your application and it's now with our team.`,
        `We'll be in touch as your application moves forward. You can check where it stands at any time:`,
      ],
    },
    SCREEN: {
      subject: (job) => `Your application for ${job} is being reviewed`,
      // ⚠️ THE ONLY TEMPLATE THAT VARIES ON SOMETHING OTHER THAN THE STAGE (M13). When the req has a
      // screening call window configured, this is the channel that carries it: "be available for a
      // call" is time-sensitive, and email interrupts where a portal the applicant may not revisit
      // does not. With no window configured the copy is exactly what M8 shipped — the hours are the
      // whole point of the extra sentences, and promising a call with no hours is worse than silence.
      paragraphs: (name, job, callWindow) => [
        `Hi ${name},`,
        `Your application for ${job} is now being reviewed by our team.`,
        ...(callWindow
          ? [
              `We would like to inform you that our team will contact you within the next few days. Please be available to receive a call between ${callWindow}.`,
              `We appreciate your patience and look forward to speaking with you.`,
              `You can check the latest here:`,
            ]
          : [`We'll let you know as soon as there's an update. You can also check the latest here:`]),
      ],
    },
    INTERVIEW: {
      subject: (job) => `Next step for your application for ${job}`,
      paragraphs: (name, job) => [
        `Hi ${name},`,
        `Good news — your application for ${job} has moved to the interview stage.`,
        `Someone from our team will be in touch to arrange the details. You can follow your progress here:`,
      ],
    },
    OFFER: {
      subject: (job) => `An update on your application for ${job}`,
      paragraphs: (name, job) => [
        `Hi ${name},`,
        `Your application for ${job} has reached the offer stage. Someone from our team will contact you directly with the details.`,
        `You can see your application status here:`,
      ],
    },
    REJECTED: {
      subject: (job) => `An update on your application for ${job}`,
      paragraphs: (name, job) => [
        `Hi ${name},`,
        // ⚠️ M5's portal copy, verbatim. Do not add a reason.
        `Thank you for your application. After reviewing your qualifications, we have decided not to move forward with your application for this position. We appreciate your interest and encourage you to apply for future opportunities.`,
        `The role you applied for was ${job}. You can see all of your applications here:`,
      ],
    },
  },
  es: {
    portalLink: "Ver mi postulación",
    signoff: "FrogsAtWorkHR",
    APPLIED: {
      subject: (job) => `Recibimos tu postulación para ${job}`,
      paragraphs: (name, job) => [
        `Hola ${name}:`,
        `Gracias por postular a ${job}. Recibimos tu postulación y ya está con nuestro equipo.`,
        `Te escribiremos a medida que avance. Puedes consultar su estado cuando quieras:`,
      ],
    },
    SCREEN: {
      subject: (job) => `Estamos revisando tu postulación para ${job}`,
      paragraphs: (name, job, callWindow) => [
        `Hola ${name}:`,
        `Nuestro equipo está revisando tu postulación para ${job}.`,
        ...(callWindow
          ? [
              `Te informamos que nuestro equipo se comunicará contigo en los próximos días. Por favor, mantente disponible para recibir una llamada entre ${callWindow}.`,
              `Agradecemos tu paciencia y esperamos poder conversar contigo.`,
              `Puedes consultar el estado aquí:`,
            ]
          : [`Te avisaremos en cuanto haya novedades. También puedes consultarlo aquí:`]),
      ],
    },
    INTERVIEW: {
      subject: (job) => `Siguiente paso en tu postulación para ${job}`,
      paragraphs: (name, job) => [
        `Hola ${name}:`,
        `Buenas noticias: tu postulación para ${job} avanzó a la etapa de entrevistas.`,
        `Alguien de nuestro equipo se pondrá en contacto para coordinar los detalles. Puedes seguir tu proceso aquí:`,
      ],
    },
    OFFER: {
      subject: (job) => `Novedades sobre tu postulación para ${job}`,
      paragraphs: (name, job) => [
        `Hola ${name}:`,
        `Tu postulación para ${job} llegó a la etapa de oferta. Alguien de nuestro equipo se comunicará contigo con los detalles.`,
        `Puedes ver el estado de tu postulación aquí:`,
      ],
    },
    REJECTED: {
      subject: (job) => `Novedades sobre tu postulación para ${job}`,
      paragraphs: (name, job) => [
        `Hola ${name}:`,
        // ⚠️ La copia del portal de M5, literal. No agregar un motivo.
        `Gracias por tu postulación. Tras revisar tu perfil, hemos decidido no continuar con tu candidatura para esta vacante. Agradecemos tu interés y te animamos a postular a futuras oportunidades.`,
        `La vacante a la que postulaste fue ${job}. Puedes ver todas tus postulaciones aquí:`,
      ],
    },
  },
};

/**
 * Build the message for one stage, in one language.
 *
 * @param {object} args
 * @param {string} args.stageKey   an APPLICANT_STAGE_VIEW key — APPLIED, SCREEN, INTERVIEW, OFFER, REJECTED
 * @param {string} [args.locale]   the CANDIDATE's locale, never the sender's. Falls back to English.
 * @param {string} args.firstName
 * @param {string} args.jobTitle
 * @param {string} args.portalUrl  where the applicant can see their applications
 * @param {string} [args.callWindow] SCREEN only (M13): the req's screening call hours, ALREADY
 *        FORMATTED by formatCallWindow — which names its zone. Passed preformatted for the same
 *        reason `when` is on the staff template: this package stays free of time-zone logic, and
 *        the portal and the email are then guaranteed to state the hours identically.
 * @returns {{subject: string, text: string, html: string} | null} null when the stage has no copy,
 *          which the caller must treat as "send nothing" rather than as an error.
 *
 * ⚠️ `portalUrl` IS A PARAMETER, NOT AN ENV READ. The ATS sends most of these, and its own
 * APP_BASE_URL points at the ATS — linking a candidate there would send them to a staff login. Each
 * caller supplies the portal's address, and this package stays free of environment assumptions.
 */
export function candidateStageEmail({
  stageKey,
  locale,
  firstName,
  jobTitle,
  portalUrl,
  callWindow,
}) {
  const pack = COPY[locale] ?? COPY[FALLBACK_LOCALE];
  const template = pack[stageKey];
  if (!template) return null;

  const name = firstName || (locale === "es" ? "hola" : "there");
  const paragraphs = template.paragraphs(name, jobTitle, callWindow);

  const text = [...paragraphs, "", portalUrl, "", `— ${pack.signoff}`].join("\n\n");
  const html =
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    `<p><a href="${escapeHtml(portalUrl)}">${escapeHtml(pack.portalLink)}</a></p>` +
    `<p style="color:#71717a;font-size:13px">— ${escapeHtml(pack.signoff)}</p>`;

  return { subject: template.subject(jobTitle), text, html };
}

/** The locales this module actually has copy for — used by tests and by callers normalising input. */
export const NOTIFICATION_LOCALES = Object.keys(COPY);

// ── Staff-facing: an interview slot awaits confirmation (M9) ─────────────────────────────────
//
// ⚠️ THIS ONE GOES TO AN EMPLOYEE, NOT A CANDIDATE, and it is the first message in the suite that
// does. It lives here beside the candidate copy because the delivery machinery is shared, not
// because staff and candidate wording belong together — keep them clearly separated below.
//
// ⚠️ THERE IS NO LOCALE STORED FOR STAFF. Neither `User` nor `Employee` has one (unlike
// `Candidate.locale`, which M8 added precisely because email needed it). So this defaults to English
// and accepts a locale only so the day someone adds `Employee.locale` this does not have to change.
const STAFF_COPY = {
  en: {
    subject: (job) => `Please confirm an interview time for ${job}`,
    paragraphs: (name, job, round, when) => [
      `Hi ${name},`,
      `You've been proposed as the interviewer for a ${round} interview on ${job}.`,
      `The time is ${when}. Nothing is offered to the candidate until you confirm it.`,
      `Confirm or decline here:`,
    ],
    link: "Review the interview time",
    signoff: "FrogsAtWorkHR",
  },
  es: {
    subject: (job) => `Confirma un horario de entrevista para ${job}`,
    paragraphs: (name, job, round, when) => [
      `Hola ${name}:`,
      `Te propusieron como entrevistador/a para una entrevista de ${round} en ${job}.`,
      `El horario es ${when}. No se le ofrece nada a la persona candidata hasta que lo confirmes.`,
      `Confirma o rechaza aquí:`,
    ],
    link: "Revisar el horario",
    signoff: "FrogsAtWorkHR",
  },
};

/**
 * Ask an interviewer to confirm a proposed slot.
 *
 * @param {object} args
 * @param {string} args.firstName  the interviewer's
 * @param {string} args.jobTitle
 * @param {string} args.roundName
 * @param {string} args.when       ALREADY FORMATTED by formatSlotWhen — the canonical string that
 *                                 names its time zone. Email has no browser to localise anything, so
 *                                 an unlabelled "15:00" would be a number, not a time.
 * @param {string} args.confirmUrl
 * @param {string} [args.locale]
 */
export function interviewerSlotEmail({ firstName, jobTitle, roundName, when, confirmUrl, locale }) {
  const pack = STAFF_COPY[locale] ?? STAFF_COPY[FALLBACK_LOCALE];
  const paragraphs = pack.paragraphs(firstName || "there", jobTitle, roundName, when);

  const text = [...paragraphs, "", confirmUrl, "", `— ${pack.signoff}`].join("\n\n");
  const html =
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    `<p><a href="${escapeHtml(confirmUrl)}">${escapeHtml(pack.link)}</a></p>` +
    `<p style="color:#71717a;font-size:13px">— ${escapeHtml(pack.signoff)}</p>`;

  return { subject: pack.subject(jobTitle), text, html };
}
