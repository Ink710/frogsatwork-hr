// Candidate-facing copy (M8). See templates.js for why THESE words live in the package while an
// app's own messages do not.
export { candidateStageEmail, NOTIFICATION_LOCALES } from "./templates.js";
export { deliverCandidateStageEmail } from "./deliver.js";

export { sendMail, DEFAULT_FROM } from "./transport.js";
