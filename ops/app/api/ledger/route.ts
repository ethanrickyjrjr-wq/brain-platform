import { NextResponse } from "next/server";
import { buildLedger } from "../../../lib/ledger";

// ISR: one fetch cycle per 5 minutes. The underlying GitHub/Supabase calls use
// Next's fetch cache (revalidate 300), so repeated reads within the window are
// served from cache — one real fetch cycle per revalidation.
export const revalidate = 300;

export async function GET() {
  const ledger = await buildLedger();
  return NextResponse.json(ledger);
}
