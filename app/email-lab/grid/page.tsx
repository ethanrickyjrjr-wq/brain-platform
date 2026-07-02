import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { labDestination } from "@/lib/project/lab-redirect";
import { AutoCreateProject } from "../AutoCreateProject";
import { EmailLabGridClient } from "./EmailLabGridClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab — Grid (North Star)" };

// Cockpit D4 — same chooser as /email-lab; the project Email tab defaults to
// the grid canvas, so grid visitors lose nothing.
export default async function EmailLabGridPage() {
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
  return <EmailLabGridClient />;
}
