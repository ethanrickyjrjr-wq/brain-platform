import { describe, it, expect } from "bun:test";
import { applyUserBrandToProject } from "./apply-brand";

/** A minimal recorder standing in for the supabase update chain. */
function recorderClient() {
  const calls: { table: string; payload: unknown; eqCol: string; eqVal: string }[] = [];
  const client = {
    from(table: string) {
      return {
        update(payload: unknown) {
          return {
            eq(eqCol: string, eqVal: string) {
              calls.push({ table, payload, eqCol, eqVal });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

describe("applyUserBrandToProject", () => {
  it("writes branding with the canonical color/logo keys when a brand resolves", async () => {
    const { client, calls } = recorderClient();
    await applyUserBrandToProject(client, "user-1", "proj-1", async () => ({
      primary: "#0f1d24",
      accent: "#c9a24b",
      logoUrl: "https://cdn/logo.png",
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("projects");
    expect(calls[0].eqCol).toBe("id");
    expect(calls[0].eqVal).toBe("proj-1");
    expect(calls[0].payload).toEqual({
      branding: {
        primary_color: "#0f1d24",
        accent_color: "#c9a24b",
        logo_url: "https://cdn/logo.png",
      },
    });
  });

  it("writes nothing when the user has no brand profile", async () => {
    const { client, calls } = recorderClient();
    await applyUserBrandToProject(client, "user-1", "proj-1", async () => null);
    expect(calls).toHaveLength(0);
  });

  it("never throws when brand resolution fails (best-effort, not a gate)", async () => {
    const { client } = recorderClient();
    await expect(
      applyUserBrandToProject(client, "user-1", "proj-1", async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
  });
});
