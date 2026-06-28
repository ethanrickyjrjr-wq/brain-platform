// scripts/migrate-email-events.mts
// Idempotent migration: creates the email_events table for Resend webhook tracking.
// Run: bun scripts/migrate-email-events.mts
import { readFileSync } from "fs";
import { parse } from "dotenv";

const secrets = parse(readFileSync(".dlt/secrets.toml", "utf-8"));
const connStr =
  secrets["destination.credentials"] ??
  `postgresql://${secrets["destination__credentials__username"] ?? "postgres"}:${secrets["destination__credentials__password"]}@${secrets["destination__credentials__host"]}/${secrets["destination__credentials__database"]}?sslmode=require`;

const db = new Bun.SQL(connStr);

await db.query(`
  CREATE TABLE IF NOT EXISTS public.email_events (
    id            bigserial PRIMARY KEY,
    resend_email_id text,
    rid           text,
    event         text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_events_event_check
      CHECK (event IN ('sent','delivered','opened','clicked','bounced','unsubscribed'))
  );
`);

await db.query(`CREATE INDEX IF NOT EXISTS email_events_rid_idx ON public.email_events (rid);`);
await db.query(
  `CREATE INDEX IF NOT EXISTS email_events_resend_email_id_idx ON public.email_events (resend_email_id);`,
);

// Dedupe guard: a given (resend_email_id, event) pair is immutable once recorded.
await db.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS email_events_dedupe_idx
    ON public.email_events (resend_email_id, event)
    WHERE resend_email_id IS NOT NULL;
`);

// RLS — read your own events (via outreach_recipients.rid join); service-role writes.
await db.query(`ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;`);
await db.query(`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'email_events' AND policyname = 'users_read_own_events'
    ) THEN
      CREATE POLICY users_read_own_events ON public.email_events
        FOR SELECT USING (
          rid IN (
            SELECT id::text FROM public.outreach_recipients
            WHERE project_id IN (
              SELECT id FROM public.projects WHERE owner_id = auth.uid()
            )
          )
        );
    END IF;
  END $$;
`);

await db.query(
  `GRANT SELECT ON public.email_events TO service_role, authenticated; NOTIFY pgrst, 'reload schema';`,
);

const rows = await db.query(`SELECT COUNT(*) AS n FROM public.email_events;`);
console.log("email_events table ready — rows:", rows[0].n);

db.close();
