# @hris/notifications

**Candidate-facing email: templates, delivery, and a substitutable transport.**

```js
import { deliverCandidateStageEmail, sendMail } from "@hris/notifications";
```

- **This package owns the TRANSPORT; each app owns the words it sends** — except candidate-facing
  copy, which lives here precisely because two apps must say the same thing.
- ⚠️ **`transport.js` is a separate module on purpose.** When it lived in `index.js`, a test mocking
  the package had no effect — Vitest treats `"@hris/notifications"` and `"./index.js"` as different
  modules, so the real nodemailer kept running while the stub sat unused. **Mock `transport.js`.**
- **`sendMail` throws rather than swallowing.** Callers decide what a failure means; they can only
  decide if they hear about it.
- **Send exactly once** by claiming first: `app_claim_notification` → send →
  `app_mark_notification`. The guarantee is a `NULLS NOT DISTINCT` unique index, and without that
  clause duplicates ship silently.

**Dev:** `SMTP_HOST` points at the Mailpit container (SMTP `:1025`, inbox `http://localhost:8025`).
Production points the same variables at a real provider — no code change.

**Consumers:** `ats`, `employee-records`, `candidate-portal`.

📖 **Full protocol and the index trap:**
[`docs/modules/notification-seam.md`](../../docs/modules/notification-seam.md)

**Tests:** `src/templates.test.js`, `apps/ats/tests/notifications.itest.js`
