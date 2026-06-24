import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

const PRIVATE_BUCKET = "project-uploads";
const PUBLIC_BUCKET = "email-media";

// Promote an existing filed photo (private) to the public bucket and return
// its durable URL. Idempotent — re-promoting an already-copied object succeeds.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await params;
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { storage_path } = await req.json().catch(() => ({}));
  if (!storage_path) return NextResponse.json({ error: "missing storage_path" }, { status: 400 });
  // project-uploads stores objects under the owner's uid — only let a user promote their own.
  if (!String(storage_path).startsWith(`${user.id}/`))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const { error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .copy(storage_path, storage_path, { destinationBucket: PUBLIC_BUCKET });
  // Already-copied is success — idempotent re-pick.
  if (error && !String(error.message).toLowerCase().includes("exists"))
    return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(storage_path);
  return NextResponse.json({ url: data.publicUrl });
}

// Upload a brand-new photo directly to the public bucket.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await params;
  const db = createClient(await cookies());
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing file" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const key = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const admin = createServiceRoleClient();
  const { error } = await admin.storage
    .from(PUBLIC_BUCKET)
    .upload(key, file, { contentType: file.type || "image/png", upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(key);
  return NextResponse.json({ url: data.publicUrl });
}
