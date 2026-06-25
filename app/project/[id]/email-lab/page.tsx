import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { inferScopeFromItems } from "@/lib/project/derive-name";
import type { ProjectItem } from "@/lib/project/items";
import { signedUploadUrls } from "@/lib/project/signed-upload-url";
import { ProjectEmailLabClient } from "./ProjectEmailLabClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email Lab" };

interface Branding {
  primary_color?: string;
  accent_color?: string;
  agent_name?: string;
  agent_title?: string;
  agent_bio?: string;
  brokerage?: string;
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, items, branding")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const branding: Branding = project.branding ?? {};
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

  // Map project branding → email token overrides
  const initialTokens: Record<string, string> = {};
  // visual identity
  if (branding.primary_color) initialTokens.PRIMARY = branding.primary_color;
  if (branding.accent_color) initialTokens.ACCENT = branding.accent_color;
  if (branding.logo_url) initialTokens.LOGO_URL = branding.logo_url;
  // agent identity — feeds COMPANY_NAME (masthead) AND the agent card tokens
  if (branding.agent_name) {
    initialTokens.COMPANY_NAME = branding.agent_name;
    initialTokens.AGENT_NAME = branding.agent_name;
  }
  if (branding.agent_title) initialTokens.AGENT_TITLE = branding.agent_title;
  if (branding.agent_bio) initialTokens.AGENT_BIO = branding.agent_bio;
  if (branding.photo_url) initialTokens.AGENT_PHOTO_URL = branding.photo_url;
  if (branding.brokerage) initialTokens.TAGLINE = branding.brokerage;
  // contact
  if (branding.contact_email) initialTokens.CONTACT_EMAIL = branding.contact_email;
  if (branding.contact_phone) initialTokens.CONTACT_PHONE = branding.contact_phone;
  // socials (branding fields added when available)
  if (branding.instagram_url) initialTokens.INSTAGRAM_URL = branding.instagram_url;
  if (branding.facebook_url) initialTokens.FACEBOOK_URL = branding.facebook_url;
  if (branding.linkedin_url) initialTokens.LINKEDIN_URL = branding.linkedin_url;
  if (branding.x_url) initialTokens.X_URL = branding.x_url;
  if (branding.tiktok_url) initialTokens.TIKTOK_URL = branding.tiktok_url;
  if (branding.youtube_url) initialTokens.YOUTUBE_URL = branding.youtube_url;
  if (branding.pinterest_url) initialTokens.PINTEREST_URL = branding.pinterest_url;
  if (branding.threads_url) initialTokens.THREADS_URL = branding.threads_url;
  if (branding.unsubscribe_url) initialTokens.UNSUBSCRIBE_URL = branding.unsubscribe_url;
  // website doubles as CTA destination
  if (branding.website_url) {
    initialTokens.WEBSITE_URL = branding.website_url;
    initialTokens.CTA_URL = branding.website_url;
  }
  // Location label from scope
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
      scope={
        scope.zip
          ? { kind: "zip", value: scope.zip }
          : scope.place
            ? { kind: "place", value: scope.place }
            : undefined
      }
      initialDoc={initialDoc}
      deliverableId={did}
      projectPhotos={projectPhotos}
    />
  );
}
