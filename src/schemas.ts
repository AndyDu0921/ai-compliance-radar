import type { Bindings } from "./types";

export function buildOpenApiSpec(env: Bindings) {
  const version = env.APP_VERSION?.trim() || "0.0.0";
  return {
    openapi: "3.1.0",
    info: {
      title: "Compliance Radar API",
      version,
      description:
        "Cloudflare Worker 版本的 AI 合规扫描接口。公开扫描接口可直接调用，任务历史仅管理员可见。"
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "system", description: "健康检查与站点元信息" },
      { name: "scan", description: "文本与文件扫描" },
      { name: "admin", description: "管理员任务历史" }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "管理员任务历史接口使用的 API Key。"
        }
      },
      schemas: {
        MetaResponse: {
          type: "object",
          properties: {
            app_name: { type: "string" },
            version: { type: "string" },
            deployed_at: { type: ["string", "null"], format: "date-time" },
            llm_enabled: { type: "boolean" },
            max_upload_mb: { type: "number" },
            allowed_uploads: { type: "array", items: { type: "string" } },
            captcha_enabled: { type: "boolean" },
            turnstile_enabled: { type: "boolean" },
            turnstile_site_key: { type: ["string", "null"] },
            admin_features: {
              type: "object",
              properties: { jobs: { type: "boolean" } }
            }
          }
        },
        TextScanRequest: {
          type: "object",
          required: ["mode", "text"],
          properties: {
            mode: { type: "string", enum: ["ad_copy", "contract_review"] },
            text: { type: "string" },
            title: { type: ["string", "null"] },
            use_llm: { type: "boolean" },
            turnstile_token: {
              type: "string",
              description: "启用 Cloudflare Turnstile 时必填。"
            }
          }
        },
        ScanResponse: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            status: { type: "string", enum: ["completed"] },
            result: { type: "object" }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          tags: ["system"],
          summary: "Health check",
          responses: { "200": { description: "Service is healthy" } }
        }
      },
      "/api/v1/meta": {
        get: {
          tags: ["system"],
          summary: "Get site metadata",
          responses: {
            "200": {
              description: "Current public configuration",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MetaResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/scan/text": {
        post: {
          tags: ["scan"],
          summary: "Submit text for compliance scan",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TextScanRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Scan completed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/scan/file": {
        post: {
          tags: ["scan"],
          summary: "Upload a text or markdown file for scanning",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "mode"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    mode: { type: "string", enum: ["ad_copy", "contract_review"] },
                    title: { type: "string" },
                    use_llm: { type: "boolean" },
                    turnstile_token: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Scan completed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/jobs": {
        get: {
          tags: ["admin"],
          summary: "List recent jobs",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 15 }
            }
          ],
          responses: {
            "200": { description: "Recent jobs" },
            "401": { description: "Invalid API key" },
            "404": { description: "Admin history disabled" }
          }
        }
      },
      "/api/v1/jobs/{job_id}": {
        get: {
          tags: ["admin"],
          summary: "Get a single job",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Job detail" },
            "401": { description: "Invalid API key" },
            "404": { description: "Admin history disabled or job not found" }
          }
        }
      }
    }
  };
}
