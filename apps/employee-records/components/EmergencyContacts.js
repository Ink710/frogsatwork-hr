"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  addEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

const fieldCls = "w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

// Shared add/edit form. `contact` present → edit mode (bound to its id); absent → add mode.
function ContactForm({ employeeId, contact, onDone }) {
  const t = useT();
  const boundAction = contact
    ? updateEmergencyContact.bind(null, contact.id)
    : addEmergencyContact.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(async (prev, formData) => {
    const res = await boundAction(prev, formData);
    if (res?.ok && onDone) onDone();
    return res;
  }, {});

  return (
    <form action={formAction} className="mt-2 grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-3">
      {state?.error && (
        <p className="sm:col-span-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {state.error}
        </p>
      )}
      <input name="name" defaultValue={contact?.name ?? ""} placeholder={t("field.name")} required className={fieldCls} />
      <input name="relationship" defaultValue={contact?.relationship ?? ""} placeholder={t("field.relationship")} required className={fieldCls} />
      <input name="phone" defaultValue={contact?.phone ?? ""} placeholder={t("field.phone")} required className={fieldCls} />
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
        <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary ?? false} />
        {t("field.primary")}
      </label>
      <div className="flex items-center gap-2 sm:justify-end">
        {contact && (
          <button type="button" onClick={onDone} className="text-xs text-zinc-500 hover:underline">
            {t("common.cancel")}
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? t("common.saving") : contact ? t("common.save") : t("ec.add")}
        </button>
      </div>
    </form>
  );
}

function DeleteButton({ contactId, disabled }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(deleteEmergencyContact.bind(null, contactId), {});
  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending || disabled}
        title={disabled ? t("ec.keepOne") : state?.error ?? t("common.delete")}
        className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
      >
        {pending ? "…" : t("common.delete")}
      </button>
    </form>
  );
}

function ContactRow({ contact, employeeId, canManage, canDelete }) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="px-4 py-2.5">
        <ContactForm employeeId={employeeId} contact={contact} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{contact.name}</span>{" "}
        <span className="text-zinc-500">({contact.relationship})</span> · {contact.phone}
        {contact.isPrimary && (
          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {t("field.primary")}
          </span>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-zinc-500 hover:underline">
            {t("common.edit")}
          </button>
          <DeleteButton contactId={contact.id} disabled={!canDelete} />
        </div>
      )}
    </li>
  );
}

// `embedded` = rendered inside a titled profile Card, so we drop the outer section + heading
// (the Card supplies the title) and keep only the Add button + list.
export function EmergencyContacts({ contacts, employeeId, canManage, embedded = false }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const Wrapper = embedded ? "div" : "section";
  const showHeader = !embedded || (canManage && !adding);

  return (
    <Wrapper className={embedded ? "" : "mt-8"}>
      {showHeader && (
        <div className="mb-3 flex items-center justify-between">
          {!embedded && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {t("ec.title")}
            </h2>
          )}
          {canManage && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {t("ec.add")}
            </button>
          )}
        </div>
      )}

      {/* Zero-state: every employee should have at least one on file. */}
      {contacts.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          {t("ec.none")}{canManage ? t("ec.pleaseAdd") : ""}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              employeeId={employeeId}
              canManage={canManage}
              canDelete={contacts.length > 1}
            />
          ))}
        </ul>
      )}

      {canManage && adding && (
        <ContactForm employeeId={employeeId} onDone={() => setAdding(false)} />
      )}
    </Wrapper>
  );
}
