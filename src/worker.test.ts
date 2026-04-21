import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app, { type Bindings } from "./worker";

class MockD1Database {
  calls: Array<{ sql: string; binds: unknown[] }> = [];

  constructor(
    private readonly handlers: {
      all?: (sql: string, binds: unknown[]) => unknown[];
      first?: (sql: string, binds: unknown[]) => unknown;
      run?: (sql: string, binds: unknown[]) => unknown;
    } = {}
  ) {}

  prepare(sql: string) {
    return {
      bind: (...binds: unknown[]) => ({
        all: async <T>() => ({
          results: (this.handlers.all?.(sql, binds) ?? []) as T[]
        }),
        first: async <T>() => (this.handlers.first?.(sql, binds) ?? null) as T | null,
        run: async () => {
          this.calls.push({ sql, binds });
          return this.handlers.run?.(sql, binds) ?? { success: true };
        }
      })
    };
  }
}

function createEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    APP_NAME: "Compliance Radar",
    APP_VERSION: "test-version",
    APP_DEPLOYED_AT: "2026-04-21T10:00:00Z",
    MAX_UPLOAD_MB: "10",
    DEFAULT_USE_LLM: "false",
    STORE_RAW_INPUT: "false",
    JOB_RETENTION_DAYS: "7",
    DB: new MockD1Database() as unknown as D1Database,
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset", { status: 200 }))
    } as unknown as Fetcher,
    ...overrides
  };
}

async function request(url: string, init: RequestInit = {}, envOverrides: Partial<Bindings> = {}) {
  const env = createEnv(envOverrides);
  const response = await app.fetch(new Request(`https://example.com${url}`, init), env);
  return { response, env };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker api", () => {
  it("returns public metadata with version and disabled admin jobs by default", async () => {
    const { response } = await request("/api/v1/meta");
    const payload = (await response.json()) as {
      version: string;
      admin_features: { jobs: boolean };
      turnstile_enabled: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.version).toBe("test-version");
    expect(payload.admin_features.jobs).toBe(false);
    expect(payload.turnstile_enabled).toBe(false);
  });

  it("returns 404 for job history when admin api key is not configured", async () => {
    const { response } = await request("/api/v1/jobs");

    expect(response.status).toBe(404);
  });

  it("returns 401 for job history when admin api key is configured but missing", async () => {
    const { response } = await request("/api/v1/jobs", {}, { ADMIN_API_KEY: "secret-key" });

    expect(response.status).toBe(401);
  });

  it("does not crash when stored report json is invalid", async () => {
    const db = new MockD1Database({
      all: (sql) => {
        if (sql.startsWith("SELECT * FROM jobs ORDER BY")) {
          return [
            {
              id: "job-1",
              title: "Bad row",
              mode: "ad_copy",
              status: "completed",
              input_method: "text",
              input_text: null,
              file_name: null,
              created_at: "2026-04-21T10:00:00Z",
              updated_at: "2026-04-21T10:00:00Z",
              error_message: null,
              result_json: "{not-valid-json"
            }
          ];
        }
        return [];
      }
    });

    const { response } = await request(
      "/api/v1/jobs",
      {
        headers: {
          "X-API-Key": "secret-key"
        }
      },
      {
        ADMIN_API_KEY: "secret-key",
        DB: db as unknown as D1Database
      }
    );

    const payload = (await response.json()) as Array<{ result: unknown; error_message: string }>;
    expect(response.status).toBe(200);
    expect(payload[0].result).toBeNull();
    expect(payload[0].error_message).toContain("invalid");
  });

  it("stores null raw input when STORE_RAW_INPUT is disabled", async () => {
    const db = new MockD1Database();
    const { response } = await request(
      "/api/v1/scan/text",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "ad_copy",
          text: "全网第一的独家方案，保证有效。"
        })
      },
      {
        DB: db as unknown as D1Database,
        STORE_RAW_INPUT: "false"
      }
    );

    expect(response.status).toBe(200);
    const insertCall = db.calls.find((call) => call.sql.startsWith("INSERT INTO jobs"));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.binds[5]).toBeNull();
  });

  it("requires turnstile token when turnstile is enabled", async () => {
    const { response } = await request(
      "/api/v1/scan/text",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "ad_copy",
          text: "保证通过"
        })
      },
      {
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key"
      }
    );

    const payload = (await response.json()) as { detail: string };
    expect(response.status).toBe(400);
    expect(payload.detail).toContain("Turnstile");
  });

  it("returns openapi json", async () => {
    const { response } = await request("/openapi.json");
    const payload = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(payload.openapi).toBe("3.1.0");
    expect(payload.paths["/api/v1/scan/text"]).toBeTruthy();
  });
});
