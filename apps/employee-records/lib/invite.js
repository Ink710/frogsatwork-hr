import "server-only";
import crypto from "node:crypto";
import { prisma } from "@hris/database";
import { sendInviteEmail } from "./email.js";

// New-hire invites. A one-time link lets an employee set their first password. The token is
// high-entropy random (256 bits), so unlike the HMAC links in sign.js it needs no signing
// secret — we store only its SHA-256 hash and compare hashes on redemption. A DB leak
// therefore exposes no usable link. One-time semantics are enforced at redemption: setPassword
// only accepts a token while the account is unactivated (emailVerifiedAt null).

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashInviteToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateInviteToken(now = Date.now()) {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashInviteToken(raw), expires: new Date(now + INVITE_TTL_MS) };
}

// Issue a fresh invite for a user and email the link. Overwriting inviteTokenHash invalidates
// any previous link (resend supersedes). No RLS on User, so plain prisma is fine and no viewer
// session is required — this can run post-commit from createEmployee or from an HR action.
// Returns { skipped:true } if the user has already activated (nothing to invite).
export async function sendInvite(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw new Error("User not found.");
  if (user.emailVerifiedAt) return { skipped: true };

  const { raw, hash, expires } = generateInviteToken();
  await prisma.user.update({
    where: { id: userId },
    data: { inviteTokenHash: hash, inviteTokenExpires: expires, invitedAt: new Date() },
  });

  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const link = `${base}/set-password?token=${raw}`;
  await sendInviteEmail({ to: user.email, name: user.name, link });
  return { ok: true };
}
