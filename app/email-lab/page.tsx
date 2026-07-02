import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { labDestination } from "@/lib/project/lab-redirect";
import { AutoCreateProject } from "./AutoCreateProject";
import { EmailLabClient } from "./EmailLabClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab — Design Surface" };

// Cockpit D4 — signed-in users work in their project's Email tab; the
// standalone lab stays the anonymous taste-surface until Phase 2.
export default async function EmailLabPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase
      .from("projects")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1);
    const dest = labDestination((data as { id: string }[] | null) ?? []);
    if (dest) redirect(dest);
    return <AutoCreateProject />;
  }
  return <EmailLabClient />;
}
