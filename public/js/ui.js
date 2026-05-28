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
    const warnings = result.warnings?.length ? result.warnings : ["未发现显著警告项。"];
    const actions = result.recommended_actions?.length ? result.recommended_actions : ["无需特定修正动作。"];
    const findings = result.risk_items?.length ? result.risk_items : [];
    const missing = result.missing_protections || [];
    const completeness = result.completeness_scores || [];
    const pills = result.poison_pills || [];
    const breakdown = result.metadata?.severity_breakdown || {};
    const signingRec = result.signing_recommendation || "";
    const riskGrade = result.risk_grade || "";
    const maxSeverity = Math.max(breakdown.critical || 0, breakdown.high || 0, breakdown.medium || 0, breakdown.low || 0, breakdown.info || 0, 1);

    this.dom.emptyState.classList.add("hidden");
    this.dom.resultPane.classList.remove("hidden");

    const criticalColor = "#ff3b30"; const highColor = "#ff9f0a"; const mediumColor = "#ffd60a";
    const lowColor = "#30d158"; const infoColor = "#8e8e93";
    const countCritical = breakdown.critical || 0; const countHigh = breakdown.high || 0;
    const countMedium = breakdown.medium || 0; const countLow = breakdown.low || 0; const countInfo = breakdown.info || 0;

    const signingStyle = signingRec.includes("拒绝") ? "background:#3d0000;color:#ff6b6b;"
      : signingRec.includes("升级") ? "background:#3d2000;color:#ffb347;"
      : signingRec.includes("谈判") ? "background:#3d3500;color:#ffd60a;"
      : "background:#003d1a;color:#30d158;";

    this.dom.resultPane.innerHTML = `
      <!-- Slack 风格摘要行 -->
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 20px;background:var(--panel);border-radius:12px;margin-bottom:16px;font-size:14px;border:1px solid var(--line);">
        <span style="font-weight:700;font-size:18px;">${escapeHtml(result.risk_score)}分</span>
        <span style="color:var(--muted);">${escapeHtml(riskGrade)}</span>
        <span style="margin-left:auto;">${countCritical ? `<span style="color:${criticalColor};">${countCritical}严重</span>` : ""} ${countHigh ? `<span style="color:${highColor};">${countHigh}高</span>` : ""} ${countMedium ? `<span style="color:${mediumColor};">${countMedium}中</span>` : ""} ${countLow ? `<span style="color:${lowColor};">${countLow}低</span>` : ""}</span>
        ${result.llm_used ? '<span style="color:var(--accent-blue);">AI增强</span>' : '<span style="color:var(--muted);">规则引擎</span>'}
        ${signingRec ? `<span style="padding:4px 12px;border-radius:6px;font-weight:600;font-size:13px;${signingStyle}">${escapeHtml(signingRec)}</span>` : ""}
      </div>

      <!-- 签署建议卡片 -->
      ${signingRec ? `
      <div style="padding:16px 20px;border-radius:12px;margin-bottom:16px;${signingStyle}">
        <strong>签署建议：${escapeHtml(signingRec)}</strong>
        <span style="display:block;margin-top:4px;opacity:0.8;font-size:13px;">评级：${escapeHtml(riskGrade)} | 风险项：${findings.length}条 | 缺失保护：${missing.length}项 | 毒丸：${pills.length}个</span>
      </div>` : ""}

      <!-- 风险仪表盘 -->
      <div class="report-block">
        <h3>风险仪表盘</h3>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${countCritical > 0 ? `<div style="display:flex;align-items:center;gap:12px;"><span style="width:40px;font-size:13px;color:${criticalColor};font-weight:600;">严重</span><div style="flex:1;background:rgba(255,59,48,0.15);border-radius:4px;height:18px;"><div style="width:${(countCritical/maxSeverity*100)}%;height:100%;background:${criticalColor};border-radius:4px;min-width:8px;"></div></div><span style="width:30px;font-size:13px;color:var(--muted);text-align:right;">${countCritical}</span></div>` : ""}
          ${countHigh > 0 ? `<div style="display:flex;align-items:center;gap:12px;"><span style="width:40px;font-size:13px;color:${highColor};font-weight:600;">高</span><div style="flex:1;background:rgba(255,159,10,0.15);border-radius:4px;height:18px;"><div style="width:${(countHigh/maxSeverity*100)}%;height:100%;background:${highColor};border-radius:4px;min-width:8px;"></div></div><span style="width:30px;font-size:13px;color:var(--muted);text-align:right;">${countHigh}</span></div>` : ""}
          ${countMedium > 0 ? `<div style="display:flex;align-items:center;gap:12px;"><span style="width:40px;font-size:13px;color:${mediumColor};font-weight:600;">中</span><div style="flex:1;background:rgba(255,214,10,0.15);border-radius:4px;height:18px;"><div style="width:${(countMedium/maxSeverity*100)}%;height:100%;background:${mediumColor};border-radius:4px;min-width:8px;"></div></div><span style="width:30px;font-size:13px;color:var(--muted);text-align:right;">${countMedium}</span></div>` : ""}
          ${countLow > 0 ? `<div style="display:flex;align-items:center;gap:12px;"><span style="width:40px;font-size:13px;color:${lowColor};font-weight:600;">低</span><div style="flex:1;background:rgba(48,209,88,0.15);border-radius:4px;height:18px;"><div style="width:${(countLow/maxSeverity*100)}%;height:100%;background:${lowColor};border-radius:4px;min-width:8px;"></div></div><span style="width:30px;font-size:13px;color:var(--muted);text-align:right;">${countLow}</span></div>` : ""}
          ${!countCritical && !countHigh && !countMedium && !countLow ? '<span style="font-size:13px;color:var(--muted);">未发现风险项</span>' : ""}
        </div>
      </div>

      <!-- 执行摘要 -->
      <div class="report-block">
        <h3>执行摘要</h3>
        <p>${escapeHtml(result.summary)}</p>
      </div>

      <!-- 缺失保护 -->
      ${missing.length ? `
      <div class="report-block">
        <h3>缺失保护条款 (${missing.length}项)</h3>
        <div class="risk-items-container">
          ${missing.map(m => {
            const urgencyColor = m.urgency === "critical" ? "#ff3b30" : m.urgency === "important" ? "#ff9f0a" : "#30d158";
            return `
            <div class="risk-item" style="border-left:3px solid ${urgencyColor};">
              <div class="risk-header">
                <div style="font-weight:600;">${escapeHtml(m.title)} <span style="font-size:11px;color:${urgencyColor};margin-left:6px;">${m.urgency === "critical" ? "严重" : m.urgency === "important" ? "重要" : "建议"}</span></div>
              </div>
              <div class="risk-explanation">${escapeHtml(m.explanation)}</div>
              ${m.suggested_clause ? `<div class="risk-suggestion" style="font-style:italic;background:rgba(41,151,255,0.08);padding:10px;border-radius:8px;margin-top:8px;">建议条款：${escapeHtml(m.suggested_clause)}</div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}

      <!-- 完整度评分 -->
      ${completeness.length ? `
      <div class="report-block">
        <h3>条款完整度评分</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">
          ${completeness.map(c => {
            const pct = (c.score / 5 * 100);
            const barColor = c.score <= 2 ? criticalColor : c.score <= 3 ? highColor : lowColor;
            return `<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${escapeHtml(c.category)}</span><span style="color:${barColor};">${c.score}/5</span></div>
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;"><div style="width:${pct}%;height:100%;background:${barColor};border-radius:2px;"></div></div>
              ${c.note ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">${escapeHtml(c.note)}</div>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}

      <!-- 风险明细清单 -->
      <div class="report-block">
        <h3>风险明细清单 (${findings.length}条)</h3>
        <div class="risk-items-container">
          ${findings.length
            ? findings.map(item => `
              <div class="risk-item">
                <div class="risk-header">
                  <div>
                    <div class="risk-title">${escapeHtml(item.title)}</div>
                    <div class="risk-meta-tags">
                      <span class="meta-tag">${escapeHtml(item.category)}</span>
                      <span class="meta-tag">${escapeHtml(item.source)}</span>
                      <span class="meta-tag">置信度 ${Math.round((item.confidence || 0) * 100)}%</span>
                      ${item.severity_breakdown ? `<span class="meta-tag">S${item.severity_breakdown.severity} L${item.severity_breakdown.likelihood} F${item.severity_breakdown.financial} A${item.severity_breakdown.asymmetry}</span>` : ""}
                    </div>
                  </div>
                  <div class="severity-badge severity-${escapeHtml(item.severity)}">${escapeHtml(formatSeverity(item.severity))}</div>
                </div>
                <div class="risk-explanation">${escapeHtml(item.explanation || "未提供详细解释。")}</div>
                ${item.excerpt ? `<div class="risk-excerpt">📄 ${escapeHtml(item.excerpt)}</div>` : ""}
                <div class="risk-suggestion">💡 ${escapeHtml(item.suggestion || "暂无具体修改建议。")}</div>
              </div>
            `).join("")
            : '<div class="risk-item"><div class="risk-title">未发现高优风险项</div><div class="risk-explanation">系统未能在此内容中匹配到明确违规点。请注意，机器审核不可替代最终的人工法务终审。</div></div>'}
        </div>
      </div>

      <!-- 建议整改 + 复核 -->
      <div class="report-grid">
        <div class="report-block" style="margin-bottom:0;">
          <h3>建议整改方案</h3>
          <ul>${actions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div class="report-block" style="margin-bottom:0;">
          <h3>人工复核提示</h3>
          <ul>${warnings.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      </div>

      <!-- 毒丸条款 -->
      ${pills.length ? `
      <div class="report-block" style="margin-top:16px;">
        <h3>毒丸条款警告 (${pills.length}个)</h3>
        <div class="risk-items-container">
          ${pills.map(p => `
            <div class="risk-item" style="border-left:3px solid ${criticalColor};">
              <div class="risk-header"><div style="font-weight:600;">📍 ${escapeHtml(p.location)}</div></div>
              <div class="risk-explanation"><strong>隐藏手法：</strong>${escapeHtml(p.technique)}</div>
              <div class="risk-suggestion">${escapeHtml(p.description)}</div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}
    `;
  }
}
