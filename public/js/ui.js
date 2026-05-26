import { escapeHtml, formatMode, formatSeverity, scoreLabel } from "./utils.js";

export class UIManager {
  constructor() {
    this.dom = {
      apiKeyInput: document.getElementById("apiKeyInput"),
      clearTextBtn: document.getElementById("clearTextBtn"),
      deployVersion: document.getElementById("deployVersion"),
      emptyState: document.getElementById("emptyState"),
      fileInput: document.getElementById("fileInput"),
      fileDropZone: document.getElementById("fileDropZone"),
      fillSampleBtn: document.getElementById("fillSampleBtn"),
      jobsSidebarBlock: document.getElementById("jobsSidebarBlock"),
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
      toastContainer: document.getElementById("toastContainer"),
      turnstileFile: document.getElementById("turnstileFile"),
      turnstileFileWrap: document.getElementById("turnstileFileWrap"),
      turnstileText: document.getElementById("turnstileText"),
      turnstileTextWrap: document.getElementById("turnstileTextWrap"),
      uploadHelpText: document.getElementById("uploadHelpText"),
      useLlmFile: document.getElementById("useLlmFile"),
      useLlmText: document.getElementById("useLlmText")
    };
  }

  showToast(message, type = "info") {
    if (!this.dom.toastContainer) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type} fade-in-up`;

    let iconSvg = "";
    if (type === "success") {
      iconSvg =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
    } else if (type === "error") {
      iconSvg =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
    } else {
      iconSvg =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    }

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    `;
    this.dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  setStatus(message, state = "success") {
    if (this.dom.statusText) {
      this.dom.statusText.textContent = message;
    }
    if (this.dom.statusBadge) {
      this.dom.statusBadge.className = "status-dot";
      if (state === "error") {
        this.dom.statusBadge.classList.add("error");
      }
      if (state === "processing") {
        this.dom.statusBadge.classList.add("processing");
      }
    }
  }

  updateMode(mode) {
    this.dom.modeButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    this.dom.textInput.placeholder =
      mode === "contract_review"
        ? "粘贴合同、协议、补充条款或采购单中的关键内容..."
        : "粘贴广告文案、直播脚本、落地页文案或促销活动内容...";
  }

  switchPane(paneId) {
    this.dom.paneButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.pane === paneId);
    });
    document.querySelectorAll(".input-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === paneId);
    });
  }

  renderMeta(data) {
    this.dom.useLlmText.checked = Boolean(data.llm_enabled);
    this.dom.useLlmFile.checked = Boolean(data.llm_enabled);
    this.dom.metaStrip.innerHTML = `
      <span><span>系统架构</span> <span>Cloudflare Workers</span></span>
      <span><span>文件限制</span> <span>${escapeHtml(data.max_upload_mb)}MB max</span></span>
      <span><span>AI 增强模块</span> <span>${data.llm_enabled ? "Online" : "Offline"}</span></span>
      <span><span>历史任务</span> <span>${data.admin_features?.jobs ? "管理员可见" : "公开关闭"}</span></span>
      <span><span>人机验证</span> <span>${data.turnstile_enabled ? "已启用" : "未启用"}</span></span>
    `;
    if (Array.isArray(data.allowed_uploads)) {
      this.dom.fileInput.accept = data.allowed_uploads.join(",");
      this.dom.uploadHelpText.textContent = `支持 ${data.allowed_uploads.join("、")}。最大体积 ${escapeHtml(data.max_upload_mb)}MB`;
    }
  }

  toggleJobsUi(enabled) {
    this.dom.jobsSidebarBlock.classList.toggle("hidden", !enabled);
    this.dom.refreshBtn.classList.toggle("hidden", !enabled);
  }

  renderJobsLockedState() {
    this.dom.recentJobs.innerHTML = '<div class="empty-state-small">输入管理员 API Key 后可查看历史任务</div>';
  }

  renderRecentJobs(jobs, activeJobId, onJobClick) {
    if (!jobs || !jobs.length) {
      this.dom.recentJobs.innerHTML = '<div class="empty-state-small">暂无任务记录</div>';
      return;
    }

    this.dom.recentJobs.innerHTML = jobs
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

    this.dom.recentJobs.querySelectorAll(".job-item").forEach((item) => {
      item.addEventListener("click", () => onJobClick(item.dataset.jobId));
    });
  }

  renderSelectedFile(file) {
    if (file) {
      this.dom.uploadHelpText.textContent = `已选择: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      this.dom.uploadHelpText.style.color = "var(--accent-blue)";
      this.dom.uploadHelpText.style.fontWeight = "600";
      return;
    }

    this.dom.fileInput.value = "";
    this.dom.uploadHelpText.textContent = "支持 .txt 和 .md 格式，最高 10MB";
    this.dom.uploadHelpText.style.color = "";
    this.dom.uploadHelpText.style.fontWeight = "";
  }

  toggleTurnstile(enabled) {
    this.dom.turnstileTextWrap.classList.toggle("hidden", !enabled);
    this.dom.turnstileFileWrap.classList.toggle("hidden", !enabled);
  }

  renderVersion(version, deployedAt) {
    if (!this.dom.deployVersion) {
      return;
    }

    const deployedLabel = deployedAt ? ` · ${new Date(deployedAt).toLocaleString()}` : "";
    this.dom.deployVersion.textContent = `Build ${escapeHtml(version)}${deployedLabel}`;
  }

  renderResult(job) {
    if (!job || !job.result) {
      this.dom.emptyState.classList.remove("hidden");
      this.dom.resultPane.classList.add("hidden");
      this.dom.resultPane.innerHTML = "";
      return;
    }

    const { result } = job;
    const warnings = result.warnings?.length ? result.warnings : ["未发现显著警告项。"];
    const actions = result.recommended_actions?.length ? result.recommended_actions : ["无需特定修正动作。"];
    const findings = result.risk_items?.length ? result.risk_items : [];

    this.dom.emptyState.classList.add("hidden");
    this.dom.resultPane.classList.remove("hidden");

    this.dom.resultPane.innerHTML = `
      <div class="result-overview">
        <div class="metric-card">
          <div class="metric-label">风险评级分值</div>
          <div class="metric-value" style="color: ${result.risk_score >= 80 ? "var(--status-critical)" : result.risk_score >= 50 ? "var(--status-warning)" : "var(--text-primary)"}">${escapeHtml(result.risk_score)}</div>
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
          <div class="metric-value" style="font-size: 16px; padding-top: 10px; font-weight: 500; word-break: break-all;">${escapeHtml((job.id || "").slice(0, 12)) || "—"}...</div>
          <div class="metric-desc">${escapeHtml(job.title || result.title || "未命名文档")}</div>
        </div>
      </div>

      <div class="report-block">
        <h3>执行摘要</h3>
        <p>${escapeHtml(result.summary)}</p>
      </div>

      <div class="report-grid">
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
}
