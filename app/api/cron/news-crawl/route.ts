// GET /api/cron/news-crawl
//
// Vercel Cron fires daily after the Python pipeline writes articles.
// Reads unprocessed rows from data_lake.news_articles_swfl, loads brand
// registry + radius config, extracts qualified events, scores each event
// against every active project with coordinates, inserts via
// insertProjectEvent(), then marks articles as processed.
//
// Returns: { processed, events_inserted, events_suppressed }

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { loadBrandRegistry, loadRadiusConfig, scoreEvent } from "@/lib/signals/event-evaluator";
import { insertProjectEvent } from "@/lib/project/event-insert";
import { extractEventFromArticle } from "@/lib/signals/news-event-extractor";
import type { NewsArticleRow } from "@/lib/signals/news-event-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 50;

export async function GET(request: Request) {
  // Vercel Cron auth — mirror data-readiness pattern exactly
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(await cookies());

  // Load scoring config (module-level cache; first call hits disk)
  const brands = loadBrandRegistry();
  const radiusConfig = loadRadiusConfig();

  // ── 1. Fetch unprocessed articles (newest first, capped at BATCH_SIZE) ──────
  const { data: articles, error: artErr } = await supabase
    .schema("data_lake")
    .from("news_articles_swfl")
    .select("id, article_url, headline, body_text, source_name, published_date")
    .is("processed_at", null)
    .order("scraped_at", { ascending: false })
    .limit(BATCH_SIZE)
    .returns<NewsArticleRow[]>();

  if (artErr) {
    console.error("[news-crawl cron] article query error:", artErr.message);
    return NextResponse.json({ error: artErr.message }, { status: 500 });
  }

  if (!articles || articles.length === 0) {
    return NextResponse.json({
      processed: 0,
      events_inserted: 0,
      events_suppressed: 0,
    });
  }

  // ── 2. Load active projects with coordinates ─────────────────────────────────
  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, lat, lng, project_type, derived_project_type")
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (projErr) {
    console.error("[news-crawl cron] projects query error:", projErr.message);
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }

  // No active projects — still mark articles processed so they don't pile up
  if (!projects || projects.length === 0) {
    await supabase
      .schema("data_lake")
      .from("news_articles_swfl")
      .update({ processed_at: new Date().toISOString() })
      .in(
        "id",
        articles.map((a) => a.id),
      );
    return NextResponse.json({
      processed: articles.length,
      events_inserted: 0,
      events_suppressed: 0,
    });
  }

  // ── 3. Score each article against each project ───────────────────────────────
  let eventsInserted = 0;
  let eventsSuppressed = 0;
  const processedIds: string[] = [];

  for (const article of articles) {
    // Extract a qualified event; null = article not signal-worthy
    const qualEvent = extractEventFromArticle(article, brands);

    if (!qualEvent) {
      processedIds.push(article.id);
      continue;
    }

    for (const project of projects) {
      const projectType = (project.project_type ?? project.derived_project_type) as string | null;

      const scored = scoreEvent(
        qualEvent,
        { lat: project.lat as number, lng: project.lng as number, project_type: projectType },
        brands,
        radiusConfig,
      );

      // Skip tier-5 / out-of-radius events — nothing to insert
      if (!scored.inject_ai && !scored.notify_user) continue;

      const result = await insertProjectEvent(supabase, project.id as string, scored);
      if (result.inserted && !result.suppressed) {
        eventsInserted++;
      } else {
        eventsSuppressed++;
      }
    }

    processedIds.push(article.id);
  }

  // ── 4. Mark articles processed ───────────────────────────────────────────────
  if (processedIds.length > 0) {
    const { error: markErr } = await supabase
      .schema("data_lake")
      .from("news_articles_swfl")
      .update({ processed_at: new Date().toISOString() })
      .in("id", processedIds);

    if (markErr) {
      console.error("[news-crawl cron] mark-processed error:", markErr.message);
      // Non-fatal — return counts; articles will be retried next run
    }
  }

  return NextResponse.json({
    processed: processedIds.length,
    events_inserted: eventsInserted,
    events_suppressed: eventsSuppressed,
  });
}
