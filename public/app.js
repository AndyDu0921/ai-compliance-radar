const adSample = `全网第一的瘦身方案，7天立刻见效！
博士团队背书，保证通过体脂管理挑战。
今天不买就没了，最后一天，错过再等一年！`;

const contractSample = `甲方有权单方修改本合同并最终解释本协议全部条款。
乙方已付款项概不退还，乙方承担全部损失。
是否验收合格由甲方决定，争议由甲方所在地法院管辖。`;

const dom = {
  apiKeyInput: document.getElementById("apiKeyInput"),
  emptyState: document.getElementById("emptyState"),
  fileInput: document.getElementById("fileInput"),
  fillSampleBtn: document.getElementById("fillSampleBtn"),
  metaStrip: document.getElementById("metaStrip"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  paneButtons: Array.from(document.querySelectorAll(".segment")),
  recentJobs: document.getElementById("recentJobs"),
  refreshBtn: document.getElementById("refreshBtn"),
  resultPane: document.getElementById("resultPane"),
  rulepackList: document.getElementById("rulepackList"),
  scanFileBtn: document.getElementById("scanFileBtn"),
  scanTextBtn: document.getElementById("scanTextBtn"),
  statusBadge: document.getElementById("statusBadge"),
  textInput: document.getElementById("textInput"),
  titleInput: document.getElementById("titleInput"),
  uploadHelpText: document.getElementById("uploadHelpText"),
  useLlmFile: document.getElementById("useLlmFile"),
  useLlmText: document.getElementById("useLlmText")
};

let activeMode = "ad_copy";
let activeJobId = null;
let allowedUploads = [".txt", ".md"];

function setStatus(message, isError = false) {
  dom.statusBadge.textContent = message;
  dom.statusBadge.classList.toggle("error", isError);
}

function apiHeaders(extra = {}) {
  const headers = { ...extra };
  const apiKey = dom.apiKeyInput.value.trim();
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMode(mode) {
  return mode === "contract_review" ? "合同条款" : "广告文案";
}

function formatSeverity(severity) {
  return {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    info: "Info"
  }[severity] || severity;
}

function scoreLabel(score) {
  if (score >= 80) return "高风险";
  if (score >= 50) return "中高风险";
  if (score >= 25) return "中风险";
  return "低风险";
}

function updateMode(mode) {
  activeMode = mode;
  dom.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  dom.textInput.placeholder =
    mode === "contract_review"
      ? "粘贴合同、协议、补充条款或采购单中的关键内容。"
      : "粘贴广告文案、直播脚本、落地页文案或促销活动内容。";
}

function switchPane(paneId) {
  dom.paneButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pane === paneId);
  });
  document.querySelectorAll(".pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === paneId);
  });
}

function renderRulepacks(rulepacks) {
  if (!rulepacks.length) {
    dom.rulepackList.innerHTML = '<p class="helper-text">尚未发现规则包。</p>';
    return;
  }
  dom.rulepackList.innerHTML = rulepacks
    .map(
      (pack) => `
        <div class="rulepack-card">
          <strong>${escapeHtml(formatMode(pack.mode))}</strong>
          <small>${pack.rule_count} 条规则 · ${pack.critical_rules} 条高优先级</small>
        </div>
      `
    )
    .join("");
}

function renderRecentJobs(jobs) {
  if (!jobs.length) {
    dom.recentJobs.innerHTML = '<p class="helper-text">还没有任务记录。</p>';
    return;
  }
  dom.recentJobs.innerHTML = jobs
    .map((job) => {
      const title = job.title || job.file_name || `任务 ${job.id.slice(0, 8)}`;
      const activeClass = job.id === activeJobId ? " active" : "";
      return `
        <button class="job-card${activeClass}" type="button" data-job-id="${job.id}">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(formatMode(job.mode))} · ${escapeHtml(job.status)}</small>
          <small>${new Date(job.created_at).toLocaleString("zh-CN")}</small>
        </button>
      `;
    })
    .join("");

  dom.recentJobs.querySelectorAll(".job-card").forEach((button) => {
    button.addEventListener("click", () => loadJob(button.dataset.jobId));
  });
}

function renderResult(job) {
  if (!job || !job.result) {
    dom.emptyState.classList.remove("hidden");
    dom.resultPane.classList.add("hidden");
    dom.resultPane.innerHTML = "";
    return;
  }

  const { result } = job;
  const warnings = result.warnings?.length ? result.warnings : ["未返回额外警示项。"];
  const actions = result.recommended_actions?.length ? result.recommended_actions : ["当前未返回建议动作。"];
  const findings = result.risk_items?.length ? result.risk_items : [];

  dom.emptyState.classList.add("hidden");
  dom.resultPane.classList.remove("hidden");
  dom.resultPane.innerHTML = `
    <div class="result-metrics">
      <article class="result-card">
        <small>风险分值</small>
        <strong>${escapeHtml(result.risk_score)}</strong>
        <small>${escapeHtml(scoreLabel(result.risk_score))}</small>
      </article>
      <article class="result-card">
        <small>命中规则</small>
        <strong>${escapeHtml(result.deterministic_hit_count)}</strong>
        <small>规则引擎识别到的确定性问题</small>
      </article>
      <article class="result-card">
        <small>模式</small>
        <strong>${escapeHtml(formatMode(result.mode))}</strong>
        <small>${result.llm_used ? "已启用 LLM 增强" : "规则扫描模式"}</small>
      </article>
      <article class="result-card">
        <small>报告标题</small>
        <strong>${escapeHtml(job.title || result.title || "未命名")}</strong>
        <small>任务 ID: ${escapeHtml(job.id.slice(0, 8))}</small>
      </article>
    </div>
    <section class="result-block">
      <h3>摘要</h3>
      <p>${escapeHtml(result.summary)}</p>
    </section>
    <section class="result-block">
      <h3>建议动作</h3>
      <ul>${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
    <section class="result-block">
      <h3>警示事项</h3>
      <ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
    <section class="result-block">
      <h3>风险明细</h3>
      <div class="risk-list">
        ${
          findings.length
            ? findings
                .map(
                  (item) => `
                    <article class="risk-item severity-${escapeHtml(item.severity)}">
                      <div class="risk-header">
                        <div>
                          <strong>${escapeHtml(item.title)}</strong>
                          <div class="risk-meta">
                            <span>${escapeHtml(item.category)}</span>
                            <span>${escapeHtml(item.source)}</span>
                            <span>置信度 ${Math.round((item.confidence || 0) * 100)}%</span>
                          </div>
                        </div>
                        <span class="risk-tag">${escapeHtml(formatSeverity(item.severity))}</span>
                      </div>
                      <p>${escapeHtml(item.explanation || "未提供解释。")}</p>
                      ${item.excerpt ? `<blockquote class="quote">${escapeHtml(item.excerpt)}</blockquote>` : ""}
                      <div class="risk-footer">
                        <small>${escapeHtml(item.suggestion || "暂无修改建议。")}</small>
                      </div>
                    </article>
                  `
                )
                .join("")
            : '<div class="result-card"><strong>未发现明确风险项</strong><small>这表示内容通过了首轮规则筛查，不代表可以跳过人工判断。</small></div>'
        }
      </div>
    </section>
  `;
}

function renderSubmittedJob(payload, title) {
  renderResult({
    id: payload.job_id,
    title: title || payload.result?.title || null,
    result: payload.result
  });
}

async function fetchMeta() {
  const response = await fetch("/api/v1/meta");
  const data = await response.json();
  dom.useLlmText.checked = Boolean(data.llm_enabled);
  dom.useLlmFile.checked = Boolean(data.llm_enabled);
  if (Array.isArray(data.allowed_uploads) && data.allowed_uploads.length) {
    allowedUploads = data.allowed_uploads;
  }
  dom.fileInput.accept = allowedUploads.join(",");
  dom.uploadHelpText.textContent = `支持 ${allowedUploads.join("、")}，文件大小受服务端配置限制。`;
  renderRulepacks(data.rulepacks || []);
  dom.metaStrip.innerHTML = `
    <span>最大上传：${escapeHtml(data.max_upload_mb)}MB</span>
    <span>LLM：${data.llm_enabled ? "已配置" : "未配置"}</span>
    <span>上传：${escapeHtml(allowedUploads.join(" / "))}</span>
  `;
}

async function refreshJobsListSilently() {
  const response = await fetch("/api/v1/jobs", { headers: apiHeaders() });
  if (!response.ok) {
    return;
  }
  renderRecentJobs(await response.json());
}

async function fetchJobs() {
  const response = await fetch("/api/v1/jobs", { headers: apiHeaders() });
  const payload = await safeJson(response);
  if (!response.ok) {
    dom.recentJobs.innerHTML = `
      <p class="helper-text">${
        response.status === 401
          ? "当前环境已启用 API Key，填写后可查看最近任务。"
          : "最近任务读取失败。"
      }</p>
    `;
    return;
  }
  renderRecentJobs(payload);
}

async function loadJob(jobId) {
  activeJobId = jobId;
  setStatus("Loading");
  const response = await fetch(`/api/v1/jobs/${jobId}`, { headers: apiHeaders() });
  const payload = await safeJson(response);
  if (!response.ok) {
    setStatus(payload.detail || "Load failed", true);
    return;
  }
  await refreshJobsListSilently();
  renderResult(payload);
  setStatus("Report loaded");
}

async function submitText() {
  const text = dom.textInput.value.trim();
  const title = dom.titleInput.value.trim() || null;
  if (!text) {
    setStatus("请输入待扫描内容", true);
    return;
  }

  setStatus("Submitting");
  const response = await fetch("/api/v1/scan/text", {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      mode: activeMode,
      text,
      title,
      use_llm: dom.useLlmText.checked
    })
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    setStatus(payload.detail || "提交失败", true);
    return;
  }
  activeJobId = payload.job_id;
  renderSubmittedJob(payload, title);
  await refreshJobsListSilently();
  setStatus("Completed");
}

async function submitFile() {
  const file = dom.fileInput.files?.[0];
  const title = dom.titleInput.value.trim() || null;
  if (!file) {
    setStatus("请选择文件", true);
    return;
  }
  const suffix = `.${file.name.split(".").pop() || ""}`.toLowerCase();
  if (!allowedUploads.includes(suffix)) {
    setStatus(`当前部署仅支持：${allowedUploads.join("、")}`, true);
    return;
  }

  setStatus("Uploading");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", activeMode);
  formData.append("title", title || "");
  formData.append("use_llm", String(dom.useLlmFile.checked));

  const response = await fetch("/api/v1/scan/file", {
    method: "POST",
    headers: apiHeaders(),
    body: formData
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    setStatus(payload.detail || "上传失败", true);
    return;
  }
  activeJobId = payload.job_id;
  renderSubmittedJob(payload, title);
  await refreshJobsListSilently();
  setStatus("Completed");
}

function fillSample() {
  dom.textInput.value = activeMode === "contract_review" ? contractSample : adSample;
  switchPane("textPane");
  setStatus("Sample loaded");
}

function setupReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}

function bindEvents() {
  dom.modeButtons.forEach((button) => {
    button.addEventListener("click", () => updateMode(button.dataset.mode));
  });
  dom.paneButtons.forEach((button) => {
    button.addEventListener("click", () => switchPane(button.dataset.pane));
  });
  dom.fillSampleBtn.addEventListener("click", fillSample);
  document.getElementById("clearTextBtn").addEventListener("click", () => {
    dom.textInput.value = "";
    setStatus("Cleared");
  });
  dom.scanTextBtn.addEventListener("click", submitText);
  dom.scanFileBtn.addEventListener("click", submitFile);
  dom.refreshBtn.addEventListener("click", async () => {
    setStatus("Refreshing");
    await fetchJobs();
    setStatus("Ready");
  });
}

async function bootstrap() {
  updateMode(activeMode);
  bindEvents();
  setupReveal();
  setStatus("Ready");
  await fetchMeta();
  await fetchJobs();
}

bootstrap();
