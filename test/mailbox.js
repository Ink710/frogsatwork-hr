// Shared state for the M8 notification stub. Deliberately contains NO `vi.mock` call.
//
// ⚠️ A `vi.mock` inside a helper function does not behave like one written in a test file: Vitest
// hoists mock registrations to the top of the file they appear in, so wrapping one in an exported
// function makes it run at call time instead — after the module under test has already been
// imported. Each suite therefore writes its own `vi.mock` block (see any *.itest.js that sends
// mail) and imports this module for the captured messages.
//
// The mock target is `packages/notifications/src/transport.js`, NOT the package itself. Mocking the
// bare specifier leaves `deliver.js` calling the real transport through its relative import, which
// looks like a working stub and is not one — the mailbox stays empty while real SMTP is attempted.
//
// Only the network hop is faked. The claim, the template, the marking and the swallow-but-log
// behaviour of `deliverCandidateStageEmail` all run for real, which is the point: the idempotency
// guarantee is worth testing against an actual database.

/** Messages that would have been sent, in order. */
export const mailbox = [];

/** Set `failNext = true` to make the next send throw once, exercising the FAILED path. */
export const mailerState = { failNext: false };

/** The stub itself. Suites reference this from inside their `vi.mock` factory. */
export async function fakeSendMail(message) {
  if (mailerState.failNext) {
    mailerState.failNext = false;
    throw new Error("test: SMTP unavailable");
  }
  mailbox.push(message);
}

/** Clear captured mail and any armed failure. Call from beforeEach, beside resetDb(). */
export function resetMailbox() {
  mailbox.length = 0;
  mailerState.failNext = false;
}
