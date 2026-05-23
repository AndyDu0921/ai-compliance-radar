import type { Context, Next } from "hono";
import type { Bindings, TurnstileResponse } from "./types";

// ── Security headers ──

export async function applyNoStoreHeaders(c: Context<{ Bindings: Bindings }>, next: Next) {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("X-Content-Type-Options", "nosniff");
}

export function htmlPage(c: Context<{ Bindings: Bindings }>, markup: string) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  return c.html(markup);
}

// ── Auth middleware ──

export async function requireJobHistoryEnabled(c: Context<{ Bindings: Bindings }>, next: Next) {
  if (!adminJobsEnabled(c.env)) {
    return c.json({ detail: "Not found" }, 404);
  }
  await next();
}

export async function requireApiKey(c: Context<{ Bindings: Bindings }>, next: Next) {
  const expected = c.env.ADMIN_API_KEY?.trim();
  if (!expected || c.req.header("X-API-Key") !== expected) {
    return c.json({ detail: "Invalid or missing API key" }, 401);
  }
  await next();
}

export function adminJobsEnabled(env: Bindings): boolean {
  return Boolean(env.ADMIN_API_KEY?.trim());
}

// ── Turnstile ──

export function isTurnstileEnabled(env: Bindings): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyTurnstileIfEnabled(
  c: Context<{ Bindings: Bindings }>,
  token: unknown
): Promise<Response | null> {
  if (!isTurnstileEnabled(c.env)) {
    return null;
  }
  if (typeof token !== "string" || !token.trim()) {
    return c.json({ detail: "Turnstile verification is required" }, 400);
  }

  const form = new FormData();
  form.set("secret", c.env.TURNSTILE_SECRET_KEY!.trim());
  form.set("response", token.trim());

  const ip = c.req.header("CF-Connecting-IP");
  if (ip) {
    form.set("remoteip", ip);
  }

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form
    });
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return c.json({ detail: "Unable to verify Turnstile token" }, 502);
  }

  if (!response.ok) {
    return c.json({ detail: "Unable to verify Turnstile token" }, 502);
  }

  const payload = (await response.json()) as TurnstileResponse;
  if (!payload.success) {
    return c.json(
      { detail: "Turnstile verification failed", error_codes: payload["error-codes"] || [] },
      400
    );
  }

  return null;
}

// ── Rate limiter ──

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
let cleanupCounter = 0;

const RATE_LIMIT = {
  WINDOW_MS: 60_000, // 1 minute
  MAX_REQUESTS: 30
};

export async function scanRateLimiter(c: Context<{ Bindings: Bindings }>, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith("/api/v1/scan/")) {
    return next();
  }

  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const now = Date.now();

  // Periodic cleanup of expired entries
  if (++cleanupCounter % 200 === 0) {
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }

  const entry = rateLimitStore.get(ip);
  if (!entry || entry.resetTime < now) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT.WINDOW_MS });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT.MAX_REQUESTS) {
    return c.json(
      { detail: "Too many requests. Please slow down and try again later." },
      429
    );
  }

  return next();
}
