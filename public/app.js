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
  fileDropZone: document.getElementById("fileDropZone"),
  fillSampleBtn: document.getElementById("fillSampleBtn"),
  metaStrip: document.getElementById("metaStrip"),
  modeButtons: Array.from(document.querySelectorAll(".segment-btn")),
  paneButtons: Array.from(document.querySelectorAll(".tab-btn")),
  recentJobs: document.getElementById("recentJobs"),
  refreshBtn: document.getElementById("refreshBtn"),
  resultPane: document.getElementById("resultPane"),
  scanFileBtn: document.getElementById("scanFileBtn"),
  scanTextBtn: document.getElementById("scanTextBtn"),
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  textInput: document.getElementById("textInput"),
  titleInput: document.getElementById("titleInput"),
  uploadHelpText: document.getElementById("uploadHelpText"),
  useLlmFile: document.getElementById("useLlmFile"),
  useLlmText: document.getElementById("useLlmText")
};

let activeMode = "ad_copy";
let activeJobId = null;
let allowedUploads = [".txt", ".md"];

function setStatus(message, state = "success") {
  if (dom.statusText) dom.statusText.textContent = message;
  
  if (dom.statusBadge) {
    dom.statusBadge.className = "status-dot";
    if (state === "error") dom.statusBadge.classList.add("error");
    if (state === "processing") dom.statusBadge.classList.add("processing");
  }
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
      ? "粘贴合同、协议、补充条款或采购单中的关键内容..."
      : "粘贴广告文案、直播脚本、落地页文案或促销活动内容...";
}

function switchPane(paneId) {
  dom.paneButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pane === paneId);
  });
  document.querySelectorAll(".input-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === paneId);
  });
}

function renderRecentJobs(jobs) {
  if (!jobs.length) {
    dom.recentJobs.innerHTML = '<div class="empty-state-small">暂无任务记录</div>';
    return;
  }
  dom.recentJobs.innerHTML = jobs
    .map((job) => {
      const title = job.title || job.file_name || `Task ${job.id.slice(0, 8)}`;
      const activeClass = job.id === activeJobId ? " active" : "";
      return `
        <div class="job-item${activeClass}" data-job-id="${job.id}">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(formatMode(job.mode))} · ${new Date(job.created_at).toLocaleDateString()}</small>
        </div>
      `;
    })
    .join("");

  dom.recentJobs.querySelectorAll(".job-item").forEach((item) => {
    item.addEventListener("click", () => loadJob(item.dataset.jobId));
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
  const warnings = result.warnings?.length ? result.warnings : ["未发现显著警告项。"];
  const actions = result.recommended_actions?.length ? result.recommended_actions : ["无需特定修正动作。"];
  const findings = result.risk_items?.length ? result.risk_items : [];

  dom.emptyState.classList.add("hidden");
  dom.resultPane.classList.remove("hidden");
  
  dom.resultPane.innerHTML = `
    <div class="result-overview">
      <div class="metric-card">
        <div class="metric-label">风险评级分值</div>
        <div class="metric-value" style="color: ${result.risk_score >= 80 ? 'var(--status-critical)' : result.risk_score >= 50 ? 'var(--status-warning)' : 'var(--text-primary)'}">${escapeHtml(result.risk_score)}</div>
        <div class="metric-desc">${escapeHtml(scoreLabel(result.risk_score))}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">明确违规项</div>
        <div class="metric-value">${escapeHtml(result.deterministic_hit_count)}</div>
        <div class="metric-desc">规则引擎匹配</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">审查模式</div>
        <div class="metric-value" style="font-size: 24px; padding-top: 6px;">${escapeHtml(formatMode(result.mode))}</div>
        <div class="metric-desc">${result.llm_used ? "AI 深度增强已开启" : "基础规则扫描"}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">任务引用</div>
        <div class="metric-value" style="font-size: 16px; padding-top: 10px; font-weight: 500; word-break: break-all;">${escapeHtml(job.id.slice(0, 12))}...</div>
        <div class="metric-desc">${escapeHtml(job.title || result.title || "未命名文档")}</div>
      </div>
    </div>

    <div class="report-block">
      <h3>执行摘要</h3>
      <p>${escapeHtml(result.summary)}</p>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
      <div class="report-block" style="margin-bottom: 0;">
        <h3>建议整改方案</h3>
        <ul>${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="report-block" style="margin-bottom: 0;">
        <h3>人工复核提示</h3>
        <ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </div>

    <div class="report-block">
      <h3>风险明细清单</h3>
      <div class="risk-items-container">
        ${
          findings.length
            ? findings
                .map(
                  (item) => `
                    <div class="risk-item">
                      <div class="risk-header">
                        <div>
                          <div class="risk-title">${escapeHtml(item.title)}</div>
                          <div class="risk-meta-tags">
                            <span class="meta-tag">${escapeHtml(item.category)}</span>
                            <span class="meta-tag">${escapeHtml(item.source)}</span>
                            <span class="meta-tag">置信度 ${Math.round((item.confidence || 0) * 100)}%</span>
                          </div>
                        </div>
                        <div class="severity-badge severity-${escapeHtml(item.severity)}">${escapeHtml(formatSeverity(item.severity))}</div>
                      </div>
                      <div class="risk-explanation">${escapeHtml(item.explanation || "未提供详细解释。")}</div>
                      ${item.excerpt ? `<div class="risk-excerpt">${escapeHtml(item.excerpt)}</div>` : ""}
                      <div class="risk-suggestion">${escapeHtml(item.suggestion || "暂无具体修改建议。")}</div>
                    </div>
                  `
                )
                .join("")
            : '<div class="risk-item"><div class="risk-title">未发现高优风险项</div><div class="risk-explanation" style="margin-top: 8px;">系统未能在此内容中匹配到明确违规点。请注意，机器审核不可替代最终的人工法务终审。</div></div>'
        }
      </div>
    </div>
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
  dom.uploadHelpText.textContent = `支持 ${allowedUploads.join("、")}。最大体积 ${escapeHtml(data.max_upload_mb)}MB`;
  
  dom.metaStrip.innerHTML = `
    <span><span>系统架构</span> <span>Cloudflare Workers</span></span>
    <span><span>文件限制</span> <span>${escapeHtml(data.max_upload_mb)}MB max</span></span>
    <span><span>AI 增强模块</span> <span>${data.llm_enabled ? "Online" : "Offline"}</span></span>
  `;
}

async function refreshJobsListSilently() {
  const response = await fetch("/api/v1/jobs", { headers: apiHeaders() });
  if (!response.ok) return;
  renderRecentJobs(await response.json());
}

async function fetchJobs() {
  const response = await fetch("/api/v1/jobs", { headers: apiHeaders() });
  const payload = await safeJson(response);
  if (!response.ok) {
    dom.recentJobs.innerHTML = `
      <div class="empty-state-small">${
        response.status === 401
          ? "需输入 API Key 以查看历史"
          : "历史记录读取失败"
      }</div>
    `;
    return;
  }
  renderRecentJobs(payload);
}

async function loadJob(jobId) {
  activeJobId = jobId;
  setStatus("加载报告中...", "processing");
  const response = await fetch(`/api/v1/jobs/${jobId}`, { headers: apiHeaders() });
  const payload = await safeJson(response);
  if (!response.ok) {
    setStatus(payload.detail || "加载失败", "error");
    return;
  }
  await refreshJobsListSilently();
  renderResult(payload);
  setStatus("报告已加载", "success");
  
  // Scroll to results
  document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
}

async function submitText() {
  const text = dom.textInput.value.trim();
  const title = dom.titleInput.value.trim() || null;
  if (!text) {
    setStatus("请输入待扫描内容", "error");
    return;
  }

  setStatus("深度分析中...", "processing");
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
    setStatus(payload.detail || "提交失败", "error");
    return;
  }
  activeJobId = payload.job_id;
  renderSubmittedJob(payload, title);
  await refreshJobsListSilently();
  setStatus("分析完成", "success");
  
  document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
}

async function submitFile() {
  const file = dom.fileInput.files?.[0];
  const title = dom.titleInput.value.trim() || null;
  if (!file) {
    setStatus("请选择文件", "error");
    return;
  }
  const suffix = \`.\${file.name.split(".").pop() || ""}\`.toLowerCase();
  if (!allowedUploads.includes(suffix)) {
    setStatus(\`不支持的文件格式。仅支持：\${allowedUploads.join("、")}\`, "error");
    return;
  }

  setStatus("文件上传并解析中...", "processing");
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
    setStatus(payload.detail || "上传失败", "error");
    return;
  }
  activeJobId = payload.job_id;
  renderSubmittedJob(payload, title);
  await refreshJobsListSilently();
  setStatus("分析完成", "success");
  
  document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
}

function fillSample() {
  dom.textInput.value = activeMode === "contract_review" ? contractSample : adSample;
  switchPane("textPane");
  setStatus("示例已载入", "success");
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  dom.fileDropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  dom.fileDropZone.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  dom.fileDropZone.classList.remove('drag-over');
  
  const files = e.dataTransfer.files;
  if (files.length) {
    dom.fileInput.files = files;
    updateFileDisplay();
  }
}

function updateFileDisplay() {
  const file = dom.fileInput.files?.[0];
  if (file) {
    dom.uploadHelpText.textContent = \`已选择: \${file.name} (\${(file.size / 1024).toFixed(1)} KB)\`;
    dom.uploadHelpText.style.color = 'var(--accent-blue)';
    dom.uploadHelpText.style.fontWeight = '500';
  }
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
    setStatus("内容已清空", "success");
  });
  dom.scanTextBtn.addEventListener("click", submitText);
  dom.scanFileBtn.addEventListener("click", submitFile);
  dom.refreshBtn.addEventListener("click", async () => {
    setStatus("刷新状态中...", "processing");
    await fetchJobs();
    setStatus("系统就绪", "success");
  });
  
  // Drag and drop for files
  if (dom.fileDropZone) {
    dom.fileDropZone.addEventListener('dragover', handleDragOver);
    dom.fileDropZone.addEventListener('dragleave', handleDragLeave);
    dom.fileDropZone.addEventListener('drop', handleDrop);
    dom.fileInput.addEventListener('change', updateFileDisplay);
  }
}

async function bootstrap() {
  updateMode(activeMode);
  bindEvents();
  setStatus("系统初始化中...", "processing");
  await fetchMeta();
  await fetchJobs();
  setStatus("系统就绪", "success");
}

bootstrap();
