import { getBoardConfig, type BoardSlug } from "./boards";

export class ResoClient {
  private baseUrl: string;
  private token: string;
  private fetch: typeof globalThis.fetch;

  constructor(slug: BoardSlug, fetchFn: typeof globalThis.fetch = globalThis.fetch) {
    const cfg = getBoardConfig(slug);
    if (!cfg.baseUrl || !cfg.token) {
      throw new Error(`RESO board '${slug}' env vars not configured`);
    }
    this.baseUrl = cfg.baseUrl;
    this.token = cfg.token;
    this.fetch = fetchFn;
  }

  async get<T>(resource: string, params: Record<string, string> = {}): Promise<T[]> {
    const results: T[] = [];
    let skip = 0;
    const top = 200;

    while (true) {
      const qs = new URLSearchParams({ $top: String(top), $skip: String(skip), ...params });
      const url = `${this.baseUrl}/${resource}?${qs}`;
      const res = await this.fetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`RESO ${resource} ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { value?: T[] } | T[];
      const page = Array.isArray(data) ? data : (data.value ?? []);
      results.push(...(page as T[]));
      if (page.length < top) break;
      skip += top;
    }
    return results;
  }
}
