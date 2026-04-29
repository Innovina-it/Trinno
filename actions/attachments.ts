"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  RegisterAttachmentInput, DeleteAttachmentInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function registerAttachmentImpl(token: string, input: {
  cardId: string;
  storagePath: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}) {
  const parsed = RegisterAttachmentInput.parse(input);
  const uploadedBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(attachments).values({
      cardId: parsed.cardId,
      storagePath: parsed.storagePath,
      filename: parsed.filename,
      mime: parsed.mime,
      sizeBytes: parsed.sizeBytes,
      uploadedBy,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteAttachmentImpl(token: string, input: { id: string }) {
  const parsed = DeleteAttachmentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select({ storagePath: attachments.storagePath })
      .from(attachments).where(eq(attachments.id, parsed.id));
    if (!row) throw new Error("Forbidden");
    const r = await tx.delete(attachments).where(eq(attachments.id, parsed.id))
      .returning({ id: attachments.id });
    if (r.length === 0) throw new Error("Forbidden");
    // Best-effort storage cleanup. Errors ignored -- orphaned blob is recoverable later.
    await admin.storage.from("card-attachments").remove([row.storagePath]).catch(() => {});
  });
}

export async function registerAttachment(input: Parameters<typeof registerAttachmentImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await registerAttachmentImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteAttachment(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteAttachmentImpl(t, input);
}
