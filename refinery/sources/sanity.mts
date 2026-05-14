import { createClient, type SanityClient } from "@sanity/client";
import { env } from "../config/env.mts";

let cached: SanityClient | null = null;

/**
 * Read-only Sanity client for the Intelligence Lake (lpyl3q9w by default — see
 * config/env.mts for why go8u2esq is dead). Published perspective only; the
 * Refinery never reads drafts and never writes. A token is optional —
 * lpyl3q9w/production published docs are public-read — but is used if present.
 */
export function getSanity(): SanityClient {
  if (cached) return cached;
  cached = createClient({
    projectId: env.sanityProjectId,
    dataset: env.sanityDataset,
    apiVersion: env.sanityApiVersion,
    useCdn: false,
    perspective: "published",
    token: env.sanityReadToken,
  });
  return cached;
}
