"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@hris/database";
import { setPasswordSchema } from "@hris/types";
import { hashInviteToken } from "@/lib/invite";

// PUBLIC action — a new hire redeeming their invite has no session yet, so there is NO
// getViewer/withViewer here. Authorization is the token itself: we look the user up by the
// token's hash and only proceed while the account is unactivated. User has no RLS, so the
// restricted runtime role can update passwordHash directly.
export async function setPassword(_prevState, formData) {
  const token = formData.get("token");
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  if (typeof token !== "string" || token.length === 0) {
    return { error: "This link is invalid or has expired. Ask HR to send a new invite." };
  }

  // Match on the HASH (the raw token is never stored). Expiry and one-time use (emailVerifiedAt
  // still null) are part of the lookup, so a used or stale link finds nothing.
  const user = await prisma.user.findFirst({
    where: {
      inviteTokenHash: hashInviteToken(token),
      inviteTokenExpires: { gt: new Date() },
      emailVerifiedAt: null,
    },
    select: { id: true },
  });
  if (!user) {
    return { error: "This link is invalid or has expired. Ask HR to send a new invite." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      emailVerifiedAt: new Date(), // marks the account active
      inviteTokenHash: null, // burn the token
      inviteTokenExpires: null,
    },
  });

  redirect("/login?activated=1");
}
