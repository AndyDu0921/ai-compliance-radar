import type { ScanMode } from "./rules";

export type { ScanMode };

export interface LlmEnv {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_SECONDS?: string;
}

export type Bindings = LlmEnv & {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
  APP_VERSION?: string;
  APP_DEPLOYED_AT?: string;
  MAX_UPLOAD_MB?: string;
  DEFAULT_USE_LLM?: string;
  ADMIN_API_KEY?: string;
  STORE_RAW_INPUT?: string;
  JOB_RETENTION_DAYS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};

export interface JobRow {
  id: string;
  title: string | null;
  mode: ScanMode;
  status: "pending" | "processing" | "completed" | "failed";
  input_method: "text" | "file";
  input_text: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  result_json: string | null;
}

export interface TextScanPayload {
  mode?: unknown;
  text?: unknown;
  title?: unknown;
  use_llm?: unknown;
  turnstile_token?: unknown;
}

export interface TurnstileResponse {
  success?: boolean;
  "error-codes"?: string[];
}
