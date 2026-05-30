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
        const title = job.title || job.file_name || `Task ${(job.id || "").slice(0, 8)}`;
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
    const warnings = result.warnings?.length ? result.warnings : [];
    const actions = result.recommended_actions?.length ? result.recommended_actions : [];
    const findings = result.risk_items?.length ? result.risk_items : [];
    const missing = result.missing_protections || [];
    const completeness = result.completeness_scores || [];
    const pills = result.poison_pills || [];
    const breakdown = result.metadata?.severity_breakdown || {};
    const signingRec = result.signing_recommendation || "";
    const riskGrade = result.risk_grade || "";
    const maxSev = Math.max(breakdown.critical || 0, breakdown.high || 0, breakdown.medium || 0, breakdown.low || 0, 1);
    const cC = breakdown.critical || 0; const cH = breakdown.high || 0;
    const cM = breakdown.medium || 0; const cL = breakdown.low || 0;

    const signingClass = signingRec.includes("拒绝") ? "reject" : signingRec.includes("升级") ? "escalate" : signingRec.includes("谈判") ? "negotiate" : "sign";

    this.dom.emptyState.classList.add("hidden");
    this.dom.resultPane.classList.remove("hidden");

    this.dom.resultPane.innerHTML = `
      <div class="summary-bar">
        <span style="font-weight:700;font-size:18px;">${escapeHtml(result.risk_score)}分</span>
        <span style="color:var(--text-tertiary);">${escapeHtml(riskGrade)}</span>
        <span style="margin-left:auto;">${cC ? `<span style="color:var(--severity-critical);font-weight:600;">${cC}严重</span>` : ""} ${cH ? `<span style="color:var(--severity-high);">${cH}高</span>` : ""} ${cM ? `<span style="color:var(--severity-medium);">${cM}中</span>` : ""} ${cL ? `<span style="color:var(--severity-low);">${cL}低</span>` : ""}</span>
        ${result.llm_used ? '<span style="color:var(--accent-blue);font-weight:600;">AI+</span>' : '<span style="color:var(--text-tertiary);">规则</span>'}
        ${signingRec ? `<span class="severity-badge ${signingClass === "reject" ? "critical" : signingClass === "escalate" ? "high" : signingClass === "negotiate" ? "medium" : "low"}">${escapeHtml(signingRec)}</span>` : ""}
      </div>

      ${signingRec ? `<div class="signing-card ${signingClass}"><strong>签署建议：${escapeHtml(signingRec)}</strong><span style="display:block;margin-top:3px;opacity:0.7;font-size:13px;">${escapeHtml(riskGrade)} · ${findings.length}条风险 · ${missing.length}项缺失 · ${pills.length}个毒丸</span></div>` : ""}

      <div class="report-block">
        <h3>风险仪表盘</h3>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${cC > 0 ? `<div class="risk-bar-row"><span class="risk-bar-label" style="color:var(--severity-critical);">严重</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${(cC/maxSev*100)}%;background:var(--severity-critical);"></div></div><span class="risk-bar-count">${cC}</span></div>` : ""}
          ${cH > 0 ? `<div class="risk-bar-row"><span class="risk-bar-label" style="color:var(--severity-high);">高</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${(cH/maxSev*100)}%;background:var(--severity-high);"></div></div><span class="risk-bar-count">${cH}</span></div>` : ""}
          ${cM > 0 ? `<div class="risk-bar-row"><span class="risk-bar-label" style="color:var(--severity-medium);">中</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${(cM/maxSev*100)}%;background:var(--severity-medium);"></div></div><span class="risk-bar-count">${cM}</span></div>` : ""}
          ${cL > 0 ? `<div class="risk-bar-row"><span class="risk-bar-label" style="color:var(--severity-low);">低</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${(cL/maxSev*100)}%;background:var(--severity-low);"></div></div><span class="risk-bar-count">${cL}</span></div>` : ""}
          ${!cC && !cH && !cM && !cL ? '<span style="font-size:13px;color:var(--text-tertiary);">未发现明确风险项</span>' : ""}
        </div>
      </div>

      <div class="report-block">
        <h3>执行摘要</h3>
        <p>${escapeHtml(result.summary)}</p>
      </div>

      ${missing.length ? `
      <div class="report-block">
        <h3>缺失保护条款 (${missing.length}项)</h3>
        <div class="risk-items-container">
          ${missing.map(m => `
            <div class="missing-card urgency-${m.urgency}">
              <div class="missing-title">${escapeHtml(m.title)} <span class="severity-badge ${m.urgency === "critical" ? "critical" : m.urgency === "important" ? "high" : "low"}">${m.urgency === "critical" ? "严重缺失" : m.urgency === "important" ? "重要" : "建议补充"}</span></div>
              <div class="missing-explanation">${escapeHtml(m.explanation)}</div>
              ${m.suggested_clause ? `<div class="missing-clause">${escapeHtml(m.suggested_clause)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      ${completeness.length ? `
      <div class="report-block">
        <h3>条款完整度评分</h3>
        <div class="completeness-grid">
          ${completeness.map(c => {
            const pct = c.score / 5 * 100;
            const fc = c.score <= 2 ? "var(--severity-critical)" : c.score <= 3 ? "var(--severity-high)" : "var(--severity-low)";
            return `<div class="completeness-item">
              <div class="completeness-header"><span>${escapeHtml(c.category)}</span><span style="color:${fc};">${c.score}/5</span></div>
              <div class="completeness-bar"><div class="completeness-fill" style="width:${pct}%;background:${fc};"></div></div>
              ${c.note ? `<div class="completeness-note">${escapeHtml(c.note)}</div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}

      <div class="report-block">
        <h3>风险明细清单 (${findings.length}条)</h3>
        <div class="risk-items-container">
          ${findings.length ? findings.map(item => `
            <div class="risk-item-card severity-${item.severity}">
              <div class="risk-card-header">
                <div>
                  <div class="risk-card-title">${escapeHtml(item.title)}</div>
                  <div class="risk-card-meta">
                    <span class="risk-tag">${escapeHtml(item.category)}</span>
                    <span class="risk-tag">${escapeHtml(item.source === "rule" ? "规则引擎" : "AI 审查")}</span>
                    <span class="risk-tag">置信度 ${Math.round((item.confidence || 0) * 100)}%</span>
                  </div>
                </div>
                <div class="severity-badge ${item.severity}">${escapeHtml(formatSeverity(item.severity))}</div>
              </div>
              ${item.excerpt ? `<div class="risk-excerpt-block">${escapeHtml(item.excerpt)}</div>` : ""}
              <div class="risk-explanation-block">${escapeHtml(item.explanation || "未提供详细解释。")}</div>
              <div class="risk-suggestion-block">${escapeHtml(item.suggestion || "暂无具体修改建议。")}</div>
            </div>
          `).join("") : '<div class="risk-item-card severity-low"><div class="risk-card-header"><div class="risk-card-title">未发现高优风险项</div></div><div class="risk-explanation-block">系统未能匹配到明确违规点。机器审核不可替代人工法务终审。</div></div>'}
        </div>
      </div>

      ${pills.length ? `
      <div class="report-block">
        <h3>毒丸条款警告 (${pills.length}个)</h3>
        <div class="risk-items-container">
          ${pills.map(p => `
            <div class="poison-card">
              <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(p.location)}</div>
              <div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;"><strong>隐藏手法：</strong>${escapeHtml(p.technique)}</div>
              <div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(p.description)}</div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      <div class="report-grid">
        ${actions.length ? `<div class="report-block" style="margin-bottom:0;"><h3>建议整改方案</h3><ul>${actions.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul></div>` : ""}
        ${warnings.length ? `<div class="report-block" style="margin-bottom:0;"><h3>人工复核提示</h3><ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>` : ""}
      </div>
    `;
  }
}
