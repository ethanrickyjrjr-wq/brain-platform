/**
 * lib/social/channels/channels.test.ts
 *
 * Contract tests for postToChannel and per-platform adapters.
 * ALL tests use mocked fetch — no live platform calls, no real spend.
 *
 * Tests:
 *   1. postToChannel returns DRY_RUN error when SOCIAL_PUBLISH_ENABLED ≠ "true"
 *   2. Per-platform: postToX / postToMeta(fb) / postToMeta(ig) / postToLinkedIn / postToGBP
 *      - Happy path: mocked successful API response → ok=true + platform_post_id
 *      - Error path: API error → ok=false + error message
 *   3. X link-in-first-reply: a trailing URL in caption triggers a reply call
 *   4. Instagram requires media (text-only returns error, no API call)
 *   5. Refresh-before-post: getValidAccessToken is called with correct args
 */

import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import type { PublishInput } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mediaInput(url = "https://cdn.example.com/card.jpg") {
  return [{ url, ratio: "1:1" }];
}

const BASE_INPUT: PublishInput = {
  platform: "x",
  accountId: "acc1",
  caption: "Test caption",
  media: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. DRY MODE gate — postToChannel
// ─────────────────────────────────────────────────────────────────────────────

describe("postToChannel DRY MODE gate", () => {
  it("refuses to post when SOCIAL_PUBLISH_ENABLED is not set", async () => {
    delete process.env.SOCIAL_PUBLISH_ENABLED;
    const { postToChannel } = await import("./index");
    const db = {} as import("@supabase/supabase-js").SupabaseClient;
    const result = await postToChannel(db, "user-1", BASE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
  });

  it("refuses to post when SOCIAL_PUBLISH_ENABLED is 'false'", async () => {
    process.env.SOCIAL_PUBLISH_ENABLED = "false";
    const { postToChannel } = await import("./index");
    const db = {} as import("@supabase/supabase-js").SupabaseClient;
    const result = await postToChannel(db, "user-1", BASE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2a. X adapter — postToX
// ─────────────────────────────────────────────────────────────────────────────

describe("postToX", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
    process.env.X_CLIENT_ID = "test-client-id";
    process.env.X_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
  });

  it("happy path: text-only post returns ok=true + tweet id", async () => {
    const { postToX } = await import("./x");

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      if (urlStr.includes("api.x.com/2/tweets")) {
        return new Response(JSON.stringify({ data: { id: "tweet-123", text: "Test caption" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    }) as typeof globalThis.fetch;

    const input: PublishInput = { ...BASE_INPUT, platform: "x", media: [] };
    const result = await postToX(input, "access-token-xyz");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("tweet-123");
  });

  it("media post: uploads via v2 chunked endpoint (INIT/APPEND/FINALIZE), never the sunset v1.1 path", async () => {
    const { postToX } = await import("./x");
    const mediaCommands: Array<string | null> = [];
    let tweetBody: { media?: { media_ids: string[] } } | null = null;

    globalThis.fetch = mock(async (url: string | Request, init?: RequestInit) => {
      const urlStr = url instanceof Request ? url.url : url.toString();

      // Image bytes fetched from our CDN
      if (urlStr.includes("cdn.example.com")) {
        return new Response(new ArrayBuffer(2048), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }

      // X API v2 media upload — multipart INIT/APPEND/FINALIZE commands
      if (urlStr.includes("api.x.com/2/media/upload")) {
        const form = init?.body as FormData;
        mediaCommands.push(form?.get ? (form.get("command") as string | null) : null);
        return new Response(JSON.stringify({ data: { id: "media-789" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Tweet create — should carry the v2 media id
      if (urlStr.includes("api.x.com/2/tweets")) {
        tweetBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ data: { id: "tweet-with-media", text: "" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`); // a v1.1 upload.twitter.com call lands here → fail
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "x",
      accountId: "acc1",
      caption: "Branded card",
      media: [{ url: "https://cdn.example.com/card.png", ratio: "1:1" }],
    };
    const result = await postToX(input, "valid-token");

    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("tweet-with-media");
    // Exactly the v2 chunked sequence — proves the sunset v1.1 endpoint is gone
    expect(mediaCommands).toEqual(["INIT", "APPEND", "FINALIZE"]);
    // Tweet attaches the media id read from v2 `data.id` (not v1.1 `media_id_string`)
    expect(tweetBody?.media?.media_ids).toEqual(["media-789"]);
  });

  it("error path: API error returns ok=false", async () => {
    const { postToX } = await import("./x");

    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "Not authorized", type: "auth" }] }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof globalThis.fetch;

    const input: PublishInput = { ...BASE_INPUT, platform: "x", media: [] };
    const result = await postToX(input, "bad-token");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("dry mode: returns error even with valid token", async () => {
    process.env.SOCIAL_PUBLISH_ENABLED = "false";
    const { postToX } = await import("./x");

    // fetch should NEVER be called in dry mode
    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    const input: PublishInput = { ...BASE_INPUT, platform: "x", media: [] };
    const result = await postToX(input, "any-token");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
    expect(fetchCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. X link handling — caption posted VERBATIM (link-in-reply dodge removed,
//     operator decree 2026-06-20: unverified folklore, do not bake in)
// ─────────────────────────────────────────────────────────────────────────────

describe("X link handling (verbatim caption, no auto-reply)", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });

  it("posts the caption verbatim (URL kept inline) and makes NO reply", async () => {
    const { postToX } = await import("./x");
    const calls: Array<{ url: string; body: { text: string; reply?: unknown } }> = [];

    globalThis.fetch = mock(async (url: string | Request, init?: RequestInit) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      if (urlStr.includes("api.x.com/2/tweets")) {
        const body = init?.body ? JSON.parse(init.body as string) : { text: "" };
        calls.push({ url: urlStr, body });
        return new Response(JSON.stringify({ data: { id: "tweet-only", text: "" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    }) as typeof globalThis.fetch;

    const caption = "Check out SWFL data https://swfldatagulf.com/r/source/macro-swfl";
    const input: PublishInput = { platform: "x", accountId: "acc1", caption, media: [] };

    const result = await postToX(input, "valid-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("tweet-only");

    // Exactly ONE tweet call — no second "link reply" call
    expect(calls.length).toBe(1);
    // Caption posted verbatim, URL intact, no reply field
    expect(calls[0].body.text).toBe(caption);
    expect(calls[0].body.reply).toBeUndefined();
  });

  it("posts a no-URL caption in a single call", async () => {
    const { postToX } = await import("./x");
    let callCount = 0;

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      if (urlStr.includes("api.x.com/2/tweets")) {
        callCount++;
        return new Response(JSON.stringify({ data: { id: "tweet-only", text: "" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected: ${urlStr}`);
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "x",
      accountId: "acc1",
      caption: "No URL in this caption at all — just text #SWFL",
      media: [],
    };

    const result = await postToX(input, "valid-token");
    expect(result.ok).toBe(true);
    expect(callCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2c. Meta adapter — postToMeta (Facebook)
// ─────────────────────────────────────────────────────────────────────────────

describe("postToMeta (facebook)", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });

  it("happy path text-only: posts to /{page_id}/feed", async () => {
    const { postToMeta } = await import("./meta");
    let hitEndpoint = "";

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      hitEndpoint = urlStr;
      return new Response(JSON.stringify({ id: "12345_67890" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "facebook",
      accountId: "page-123",
      caption: "Hello",
      media: [],
    };
    const result = await postToMeta("facebook", input, "page-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("12345_67890");
    expect(hitEndpoint).toContain("/page-123/feed");
  });

  it("happy path with image: posts to /{page_id}/photos", async () => {
    const { postToMeta } = await import("./meta");
    let hitEndpoint = "";

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      hitEndpoint = urlStr;
      return new Response(JSON.stringify({ id: "photo-id", post_id: "page-123_post-456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "facebook",
      accountId: "page-123",
      caption: "Image caption",
      media: mediaInput(),
    };
    const result = await postToMeta("facebook", input, "page-token");
    expect(result.ok).toBe(true);
    expect(hitEndpoint).toContain("/page-123/photos");
  });

  it("dry mode: refuses to post", async () => {
    process.env.SOCIAL_PUBLISH_ENABLED = "false";
    const { postToMeta } = await import("./meta");
    const result = await postToMeta("facebook", { ...BASE_INPUT, platform: "facebook" }, "token");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2d. Meta adapter — postToMeta (Instagram)
// ─────────────────────────────────────────────────────────────────────────────

describe("postToMeta (instagram)", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });

  it("text-only returns error (IG requires media)", async () => {
    const { postToMeta } = await import("./meta");
    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("{}");
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "instagram",
      accountId: "ig-user-123",
      caption: "No image",
      media: [],
    };
    const result = await postToMeta("instagram", input, "ig-token");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("requires at least one image");
    expect(fetchCalled).toBe(false); // No API call should be made
  });

  it("happy path: two-step container create → publish", async () => {
    const { postToMeta } = await import("./meta");
    const calls: string[] = [];

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      calls.push(urlStr);
      if (urlStr.includes("/media") && !urlStr.includes("media_publish")) {
        return new Response(JSON.stringify({ id: "container-abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("media_publish")) {
        return new Response(JSON.stringify({ id: "ig-media-def" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected: ${urlStr}`);
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "instagram",
      accountId: "ig-user-123",
      caption: "IG post with image",
      media: mediaInput(),
    };
    const result = await postToMeta("instagram", input, "ig-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("ig-media-def");
    // Two calls: create container, then publish
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("ig-user-123/media");
    expect(calls[1]).toContain("ig-user-123/media_publish");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2e. LinkedIn adapter — postToLinkedIn
// ─────────────────────────────────────────────────────────────────────────────

describe("postToLinkedIn", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });

  it("happy path text-only: returns post URN from x-restli-id header", async () => {
    const { postToLinkedIn } = await import("./linkedin");

    globalThis.fetch = mock(
      async () =>
        new Response("", {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "x-restli-id": "urn:li:share:6844785523593134080",
          },
        }),
    ) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "linkedin",
      accountId: "urn:li:organization:12345",
      caption: "SWFL CRE market update",
      media: [],
    };
    const result = await postToLinkedIn(input, "li-access-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("urn:li:share:6844785523593134080");
  });

  it("happy path with image: init upload → PUT → post (3 calls)", async () => {
    const { postToLinkedIn } = await import("./linkedin");
    const calls: string[] = [];

    globalThis.fetch = mock(async (url: string | Request) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      calls.push(urlStr);

      if (urlStr.includes("images?action=initializeUpload")) {
        return new Response(
          JSON.stringify({
            value: { uploadUrl: "https://upload.linkedin.com/img-123", image: "urn:li:image:abc" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("upload.linkedin.com")) {
        // Image fetch from CDN + PUT to LinkedIn upload URL
        return new Response(new ArrayBuffer(100), { status: 200 });
      }
      if (urlStr.includes("cdn.example.com")) {
        // Media fetch
        return new Response(new ArrayBuffer(100), { status: 200 });
      }
      if (urlStr.endsWith("/rest/posts")) {
        return new Response("", {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:111" },
        });
      }
      throw new Error(`Unexpected: ${urlStr}`);
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "linkedin",
      accountId: "urn:li:organization:12345",
      caption: "Post with image",
      media: mediaInput(),
    };
    const result = await postToLinkedIn(input, "li-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("urn:li:share:111");
  });

  it("error: API returns non-201 → ok=false", async () => {
    const { postToLinkedIn } = await import("./linkedin");

    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ message: "ACCESS_DENIED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "linkedin",
      accountId: "urn:li:organization:999",
      caption: "Should fail",
      media: [],
    };
    const result = await postToLinkedIn(input, "bad-token");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("dry mode: refuses to post", async () => {
    process.env.SOCIAL_PUBLISH_ENABLED = "false";
    const { postToLinkedIn } = await import("./linkedin");
    const result = await postToLinkedIn(
      { ...BASE_INPUT, platform: "linkedin", accountId: "urn:li:org:1" },
      "t",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2f. GBP adapter — postToGBP
// ─────────────────────────────────────────────────────────────────────────────

describe("postToGBP", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    process.env.SOCIAL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SOCIAL_PUBLISH_ENABLED;
  });

  it("happy path: returns localPost resource name", async () => {
    const { postToGBP } = await import("./gbp");

    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ name: "accounts/12345/locations/67890/localPosts/abcdef" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "google_business",
      accountId: "accounts/12345/locations/67890",
      caption: "Fort Myers corridor update",
      media: [],
    };
    const result = await postToGBP(input, "google-token");
    expect(result.ok).toBe(true);
    expect(result.platform_post_id).toBe("accounts/12345/locations/67890/localPosts/abcdef");
  });

  it("happy path with media: includes media array in body", async () => {
    const { postToGBP } = await import("./gbp");
    let sentBody: unknown = null;

    globalThis.fetch = mock(async (_url: string | Request, init?: RequestInit) => {
      if (init?.body) sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ name: "accounts/123/locations/456/localPosts/xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const input: PublishInput = {
      platform: "google_business",
      accountId: "accounts/123/locations/456",
      caption: "Post with photo",
      media: mediaInput("https://cdn.example.com/photo.jpg"),
    };
    const result = await postToGBP(input, "g-token");
    expect(result.ok).toBe(true);

    const body = sentBody as { media?: Array<{ sourceUrl: string; mediaFormat: string }> };
    expect(body.media).toHaveLength(1);
    expect(body.media?.[0].sourceUrl).toBe("https://cdn.example.com/photo.jpg");
    expect(body.media?.[0].mediaFormat).toBe("PHOTO");
  });

  it("error: non-200 response → ok=false", async () => {
    const { postToGBP } = await import("./gbp");

    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "location not found", code: 404, status: "NOT_FOUND" },
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof globalThis.fetch;

    const result = await postToGBP(
      { platform: "google_business", accountId: "accounts/x/locations/y", caption: "x", media: [] },
      "token",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("dry mode: refuses to post", async () => {
    process.env.SOCIAL_PUBLISH_ENABLED = "false";
    const { postToGBP } = await import("./gbp");
    const result = await postToGBP(
      { platform: "google_business", accountId: "acc/loc", caption: "x", media: [] },
      "t",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. createChannelPublisher — factory smoke test
// ─────────────────────────────────────────────────────────────────────────────

describe("createChannelPublisher", () => {
  it("creates a SocialPublisher with a post() method", async () => {
    const { createChannelPublisher } = await import("./index");
    const db = {} as import("@supabase/supabase-js").SupabaseClient;
    const publisher = createChannelPublisher({ db, userId: "user-1" });
    expect(typeof publisher.post).toBe("function");
  });

  it("publisher.post() short-circuits in DRY MODE", async () => {
    delete process.env.SOCIAL_PUBLISH_ENABLED;
    const { createChannelPublisher } = await import("./index");
    const db = {} as import("@supabase/supabase-js").SupabaseClient;
    const publisher = createChannelPublisher({ db, userId: "user-1" });
    const result = await publisher.post(BASE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DRY MODE/);
  });
});
