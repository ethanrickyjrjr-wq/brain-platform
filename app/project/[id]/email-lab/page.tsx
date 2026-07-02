import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import { ProjectEmailLabClient } from "./ProjectEmailLabClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab" };

interface Branding {
  primary_color?: string;
  accent_color?: string;
  text_color?: string;
  backdrop_color?: string;
  agent_name?: string;
  agent_title?: string;
  agent_bio?: string;
  brokerage?: string;
  license?: string;
  nickname?: string;
  quote?: string;
  business_address?: string;
  logo_url?: string;
  photo_url?: string;
  contact_email?: string;
  contact_phone?: string;
  website_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  linkedin_url?: string;
  x_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
  pinterest_url?: string;
  threads_url?: string;
  unsubscribe_url?: string;
}

export default async function ProjectEmailLabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const did = sp.did ?? null;
  const seedId = sp.seed ?? null;
  // Returning from the contacts-upload detour re-opens the schedule modal (?schedule=1).
  const autoOpenSchedule = sp.schedule === "1";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, items, branding, ui_state")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const branding: Branding = (project.branding ?? {}) as Branding;
  const items: ProjectItem[] = Array.isArray(project.items) ? project.items : [];
  const scope = inferScopeFromItems(items);

  // Load image file items + 1h signed display URLs for the Photos panel.
  const imageItems = items.filter(
    (i): i is Extract<ProjectItem, { kind: "file" }> =>
      i.kind === "file" && Boolean(i.mime?.startsWith("image/")),
  );
  const imageSignedUrls =
    imageItems.length > 0
      ? await signedUploadUrls(
          supabase,
          imageItems.map((i) => i.storage_path),
        )
      : {};
  const projectPhotos = imageItems
    .filter((i) => imageSignedUrls[i.storage_path])
    .map((i) => ({
      storage_path: i.storage_path,
      signedUrl: imageSignedUrls[i.storage_path],
      caption: i.caption,
    }));

  // Map project branding → email token overrides via the ONE shared brand bridge
  // (same mapping the lab's live brand panel uses → editing brand in either place
  // produces the same email). Scope-derived HERO_LABEL is not brand, added here.
  const initialTokens: Record<string, string> = brandingToTokens(
    branding as Record<string, string>,
  );
  if (scope.place) {
    initialTokens.HERO_LABEL = `${scope.place}${scope.zip ? ` ${scope.zip}` : ""}`;
  } else if (scope.zip) {
    initialTokens.HERO_LABEL = scope.zip;
  }

  let initialDoc: import("@/lib/email/doc/types").EmailDoc | null = null;
  if (did) {
    const { data } = await supabase
      .from("deliverables")
      .select("id, doc")
      .eq("id", did)
      .eq("project_id", id)
      .eq("template", "block-canvas")
      .single();
    if (data?.doc) initialDoc = data.doc as import("@/lib/email/doc/types").EmailDoc;
  } else if (seedId) {
    const { seedById } = await import("@/lib/email/doc/default-docs");
    initialDoc = seedById(seedId)?.build() ?? null;
  }

  return (
    <ProjectEmailLabClient
      projectId={id}
      projectTitle={project.title ?? "Project"}
      initialTokens={initialTokens}
      initialBranding={branding as Record<string, string>}
      scope={
        scope.zip
          ? { kind: "zip", value: scope.zip }
          : scope.place
            ? { kind: "place", value: scope.place }
            : undefined
      }
      initialDoc={initialDoc}
      deliverableId={did}
      autoOpenSchedule={autoOpenSchedule}
      projectPhotos={projectPhotos}
      uiState={(project.ui_state ?? {}) as import("../workspace/types").ProjectUiState}
    />
  );
}
