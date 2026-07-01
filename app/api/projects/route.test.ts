import { test, expect, mock, beforeEach } from "bun:test";

// Mutable scenario the mocked cookie client reads — lets each test vary auth/db.
// `captured` holds the last insert row so a test can assert the persisted columns.
const scenario: {
  user: { id: string } | null;
  insertError: unknown;
  captured: Record<string, unknown> | null;
} = {
  user: { id: "user-a" },
  insertError: null,
  captured: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    // Chainable stub: project insert (.insert) PLUS the brand lookup that runs after
    // insert — resolveUserBrand() does .from("user_brand_profiles").select(...).eq(...)
    // .single(). { data: null } = "no brand on file", so the route's update branch is
    // skipped. Without .select this threw "supabase.from(...).select is not a function".
    from: (table: string) => {
      const chain = {
        insert: async (row: Record<string, unknown>) => {
          // Capture ONLY the projects insert — logActivity() inserts an activity row
          // afterward through this same shared stub, which would otherwise clobber it.
          if (table === "projects") scenario.captured = row;
          return { error: scenario.insertError };
        },
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        single: async () => ({ data: null }),
      };
      return chain;
    },
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("@/lib/highlighter/meter", () => ({ recordUse: async () => 1 }));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.insertError = null;
  scenario.captured = null;
});

test("unauthenticated POST → 401", async () => {
  scenario.user = null;
  const res = await POST(makeReq({ title: "x" }));
  expect(res.status).toBe(401);
});

test("authed POST with no items → 200, 12-char id", async () => {
  const res = await POST(makeReq({ title: "My deck" }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.id).toHaveLength(12);
});

test("invalid items payload → 422 (zod)", async () => {
  const res = await POST(makeReq({ items: [{ kind: "bogus" }] }));
  expect(res.status).toBe(422);
});

test("listing kind + subject_address are persisted", async () => {
  const res = await POST(
    makeReq({ title: "123 Main St", kind: "listing", subject_address: "123 Main St, Naples" }),
  );
  expect(res.status).toBe(200);
  expect(scenario.captured?.kind).toBe("listing");
  expect(scenario.captured?.subject_address).toBe("123 Main St, Naples");
});

test("kind defaults to 'general' and subject_address to null when omitted", async () => {
  const res = await POST(makeReq({ title: "My deck" }));
  expect(res.status).toBe(200);
  expect(scenario.captured?.kind).toBe("general");
  expect(scenario.captured?.subject_address).toBeNull();
});

test("an unknown kind value falls back to 'general'", async () => {
  await POST(makeReq({ title: "x", kind: "bogus" }));
  expect(scenario.captured?.kind).toBe("general");
});

test("listing with a blank address parses the subject address from the title", async () => {
  await POST(makeReq({ title: "3412 Atlantic Ave, Naples", kind: "listing" }));
  expect(scenario.captured?.subject_address).toBe("3412 Atlantic Ave, Naples");
});

test("an explicit subject_address is never overwritten by the title parse", async () => {
  await POST(
    makeReq({ title: "9999 Other Rd", kind: "listing", subject_address: "123 Main St, Naples" }),
  );
  expect(scenario.captured?.subject_address).toBe("123 Main St, Naples");
});

test("a general project never title-parses an address", async () => {
  await POST(makeReq({ title: "3412 Atlantic Ave, Naples" }));
  expect(scenario.captured?.subject_address).toBeNull();
});
