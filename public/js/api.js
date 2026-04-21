// public/js/api.js
export class ApiClient {
  static getHeaders(apiKey = "") {
    const headers = {};
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  }

  static async safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  static async fetchMeta() {
    const res = await fetch("/api/v1/meta");
    if (!res.ok) throw new Error("获取系统配置失败");
    return res.json();
  }

  static async fetchJobs(apiKey = "") {
    const res = await fetch("/api/v1/jobs", { headers: this.getHeaders(apiKey) });
    if (!res.ok) {
      if (res.status === 404) throw new Error("当前部署未开放历史任务访问");
      if (res.status === 401) throw new Error("需输入 API Key 以查看历史记录");
      throw new Error("历史记录读取失败");
    }
    return res.json();
  }

  static async loadJob(jobId, apiKey = "") {
    const res = await fetch(`/api/v1/jobs/${jobId}`, { headers: this.getHeaders(apiKey) });
    const payload = await this.safeJson(res);
    if (!res.ok) throw new Error(payload.detail || "报告加载失败");
    return payload;
  }

  static async submitText(payload, apiKey = "") {
    const res = await fetch("/api/v1/scan/text", {
      method: "POST",
      headers: { ...this.getHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await this.safeJson(res);
    if (!res.ok) throw new Error(data.detail || "文本扫描提交失败");
    return data;
  }

  static async submitFile(formData, apiKey = "") {
    const res = await fetch("/api/v1/scan/file", {
      method: "POST",
      headers: this.getHeaders(apiKey),
      body: formData
    });
    const data = await this.safeJson(res);
    if (!res.ok) throw new Error(data.detail || "文件扫描提交失败");
    return data;
  }
}
