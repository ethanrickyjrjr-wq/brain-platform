import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

const PUBLIC_BUCKET = "email-media";

// PUT /api/email-lab/media — upload a photo in the standalone Email Lab
// (no project context). Stores under the user's uid in the shared email-media
// public bucket; returns a durable public URL for the image block.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing file" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const key = `${user.id}/lab/${crypto.randomUUID()}.${ext}`;

  const admin = createServiceRoleClient();
  const { error } = await admin.storage
    .from(PUBLIC_BUCKET)
    .upload(key, file, { contentType: file.type || "image/png", upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(key);
  return NextResponse.json({ url: data.publicUrl });
}
