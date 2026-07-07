"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  addEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} from "@/app/employees/[id]/actions";

const fieldCls = "w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

// Shared add/edit form. `contact` present → edit mode (bound to its id); absent → add mode.
// onDone closes an inline editor after a successful write.
function ContactForm({ employeeId, contact, onDone }) {
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
      <input name="name" defaultValue={contact?.name ?? ""} placeholder="Name" required className={fieldCls} />
      <input name="relationship" defaultValue={contact?.relationship ?? ""} placeholder="Relationship" required className={fieldCls} />
      <input name="phone" defaultValue={contact?.phone ?? ""} placeholder="Phone" required className={fieldCls} />
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:col-span-2">
        <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary ?? false} />
        Primary contact
      </label>
      <div className="flex items-center gap-2 sm:justify-end">
        {contact && (
          <button type="button" onClick={onDone} className="text-xs text-zinc-500 hover:underline">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? "Saving…" : contact ? "Save" : "Add contact"}
        </button>
      </div>
    </form>
  );
}

function DeleteButton({ contactId, disabled }) {
  const [state, formAction, pending] = useActionState(deleteEmergencyContact.bind(null, contactId), {});
  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending || disabled}
        title={disabled ? "You must keep at least one emergency contact" : state?.error ?? "Delete contact"}
        className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
      >
        {pending ? "…" : "Delete"}
      </button>
    </form>
  );
}

function ContactRow({ contact, employeeId, canManage, canDelete }) {
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
            Primary
          </span>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-zinc-500 hover:underline">
            Edit
          </button>
          <DeleteButton contactId={contact.id} disabled={!canDelete} />
        </div>
      )}
    </li>
  );
}

export function EmergencyContacts({ contacts, employeeId, canManage }) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Emergency contacts
        </h2>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Add contact
          </button>
        )}
      </div>

      {/* Zero-state: every employee should have at least one on file. */}
      {contacts.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          No emergency contact on file.{canManage ? " Please add one." : ""}
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
    </section>
  );
}
