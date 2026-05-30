import { sampleTexts } from "./utils.js";
import { ApiClient } from "./api.js";
import { UIManager } from "./ui.js";
import { TurnstileManager } from "./turnstile.js";

class App {
  constructor() {
    this.ui = new UIManager();
    this.turnstile = new TurnstileManager();
    this.activeMode = "ad_copy";
    this.activeJobId = null;
    this.allowedUploads = [".txt", ".md"];
    this.selectedFile = null;
    this.jobsEnabled = false;
  }

  async init() {
    this.ui.updateMode(this.activeMode);
    this.bindEvents();
    this.startScannerAnimation();

    this.ui.setStatus("系统初始化中...", "processing");
    try {
      const meta = await ApiClient.fetchMeta();
      this.allowedUploads = Array.isArray(meta.allowed_uploads) ? meta.allowed_uploads : this.allowedUploads;
      this.jobsEnabled = Boolean(meta.admin_features?.jobs);

      this.ui.renderMeta(meta);
      this.ui.toggleJobsUi(this.jobsEnabled);
      this.ui.renderVersion(meta.version, meta.deployed_at);

      this.turnstile.configure(meta.turnstile_enabled, meta.turnstile_site_key);
      this.ui.toggleTurnstile(this.turnstile.isRequired());

      if (this.turnstile.isRequired()) {
        await this.turnstile.setup({
          text: this.ui.dom.turnstileText,
          file: this.ui.dom.turnstileFile
        });
      }

      if (this.jobsEnabled) {
        this.ui.renderJobsLockedState();
      }

      this.ui.setStatus("系统就绪", "success");
    } catch (error) {
      this.ui.setStatus("初始化存在警告", "error");
      this.ui.showToast(error.message, "error");
    }
  }

  bindEvents() {
    this.ui.dom.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeMode = button.dataset.mode;
        this.ui.updateMode(this.activeMode);
      });
    });

    this.ui.dom.paneButtons.forEach((button) => {
      button.addEventListener("click", () => this.ui.switchPane(button.dataset.pane));
    });

    this.ui.dom.fillSampleBtn.addEventListener("click", () => {
      this.ui.dom.textInput.value = sampleTexts[this.activeMode];
      this.ui.switchPane("textPane");
      this.ui.showToast("示例内容已载入", "success");
    });

    this.ui.dom.clearTextBtn.addEventListener("click", () => {
      this.ui.dom.textInput.value = "";
      this.ui.showToast("内容已清空", "info");
    });

    this.ui.dom.scanTextBtn.addEventListener("click", () => this.submitText());
    this.ui.dom.scanFileBtn.addEventListener("click", () => this.submitFile());

    this.ui.dom.refreshBtn.addEventListener("click", async () => {
      if (!this.jobsEnabled) {
        this.ui.showToast("当前部署未开放历史任务访问", "info");
        return;
      }
      if (!this.getAdminApiKey()) {
        this.ui.showToast("请输入管理员 API Key 后再读取历史任务", "error");
        this.ui.renderJobsLockedState();
        return;
      }

      this.ui.setStatus("刷新状态中...", "processing");
      await this.refreshJobs();
      this.ui.setStatus("系统就绪", "success");
      this.ui.showToast("任务列表已刷新", "success");
    });

    this.ui.dom.fileInput.addEventListener("change", () => {
      this.handleSelectedFile(this.ui.dom.fileInput.files?.[0] || null);
    });

    const { fileDropZone } = this.ui.dom;
    fileDropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      fileDropZone.classList.add("drag-over");
    });
    fileDropZone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      fileDropZone.classList.remove("drag-over");
    });
    fileDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      fileDropZone.classList.remove("drag-over");
      this.handleSelectedFile(event.dataTransfer?.files?.[0] || null);
    });
  }

  getAdminApiKey() {
    return this.ui.dom.apiKeyInput.value.trim();
  }

  async refreshJobs(silent = false) {
    if (!this.jobsEnabled) {
      this.ui.toggleJobsUi(false);
      return;
    }

    const apiKey = this.getAdminApiKey();
    if (!apiKey) {
      this.ui.renderJobsLockedState();
      return;
    }

    try {
      const jobs = await ApiClient.fetchJobs(apiKey);
      this.ui.renderRecentJobs(jobs, this.activeJobId, this.loadJob.bind(this));
    } catch (error) {
      this.ui.dom.recentJobs.innerHTML = `<div class="empty-state-small">${error.message}</div>`;
      if (!silent) {
        this.ui.showToast(error.message, "error");
      }
    }
  }

  async loadJob(jobId) {
    this.activeJobId = jobId;
    this.ui.setStatus("加载报告中...", "processing");

    try {
      const payload = await ApiClient.loadJob(jobId, this.getAdminApiKey());
      await this.refreshJobs(true);
      this.ui.renderResult(payload);
      this.ui.setStatus("报告已加载", "success");
      document.querySelector(".results-section").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      this.ui.setStatus("加载失败", "error");
      this.ui.showToast(error.message, "error");
    }
  }

  async submitText() {
    const text = this.ui.dom.textInput.value.trim();
    const title = this.ui.dom.titleInput.value.trim() || null;

    if (!text) {
      this.ui.showToast("请输入待扫描内容", "error");
      return;
    }

    if (this.turnstile.isRequired() && !this.turnstile.getToken("text")) {
      this.ui.showToast("请先完成文本扫描的人机验证", "error");
      return;
    }

    this.ui.setStatus("提交中...", "processing");
    try {
      const payload = await ApiClient.submitText(
        { mode: this.activeMode, text, title, use_llm: this.ui.dom.useLlmText.checked, turnstile_token: this.turnstile.getToken("text") },
        this.getAdminApiKey()
      );

      this.activeJobId = payload.job_id;
      const jobRef = { id: payload.job_id, title: title || payload.result?.title, result: payload.result };
      this.ui.renderResult(jobRef);
      this.turnstile.reset("text");

      if (payload.llm_pending) {
        this.ui.setStatus("AI 深度分析中...", "processing");
        this.ui.showToast("规则引擎报告已生成，AI 增强分析进行中...", "info");
        this.pollForLlm(payload.job_id, jobRef);
      } else {
        this.ui.setStatus("分析完成", "success");
        this.ui.showToast("报告生成完毕", "success");
      }
      document.querySelector(".results-section").scrollIntoView({ behavior: "smooth" });

      if (this.jobsEnabled && this.getAdminApiKey()) {
        await this.refreshJobs(true);
      }
    } catch (error) {
      this.ui.setStatus("提交失败", "error");
      this.ui.showToast(error.message, "error");
      this.turnstile.reset("text");
    }
  }

  async submitFile() {
    const file = this.selectedFile;
    const title = this.ui.dom.titleInput.value.trim() || null;

    if (!file) {
      this.ui.showToast("请选择文件", "error");
      return;
    }

    const suffix = `.${file.name.split(".").pop() || ""}`.toLowerCase();
    if (!this.allowedUploads.includes(suffix)) {
      this.ui.showToast(`不支持的文件格式。仅支持：${this.allowedUploads.join("、")}`, "error");
      return;
    }

    if (this.turnstile.isRequired() && !this.turnstile.getToken("file")) {
      this.ui.showToast("请先完成文件扫描的人机验证", "error");
      return;
    }

    this.ui.setStatus("上传中...", "processing");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", this.activeMode);
    formData.append("title", title || "");
    formData.append("use_llm", String(this.ui.dom.useLlmFile.checked));
    if (this.turnstile.getToken("file")) {
      formData.append("turnstile_token", this.turnstile.getToken("file"));
    }

    try {
      const payload = await ApiClient.submitFile(formData, this.getAdminApiKey());
      this.activeJobId = payload.job_id;
      const jobRef = { id: payload.job_id, title: title || payload.result?.title, result: payload.result };
      this.ui.renderResult(jobRef);

      if (payload.llm_pending) {
        this.ui.setStatus("AI 深度分析中...", "processing");
        this.ui.showToast("规则引擎报告已生成，AI 增强分析进行中...", "info");
        this.pollForLlm(payload.job_id, jobRef);
      } else {
        this.ui.setStatus("分析完成", "success");
        this.ui.showToast("报告生成完毕", "success");
      }
      document.querySelector(".results-section").scrollIntoView({ behavior: "smooth" });
      this.handleSelectedFile(null);
      this.turnstile.reset("file");

      if (this.jobsEnabled && this.getAdminApiKey()) {
        await this.refreshJobs(true);
      }
    } catch (error) {
      this.ui.setStatus("上传失败", "error");
      this.ui.showToast(error.message, "error");
      this.turnstile.reset("file");
    }
  }

  async pollForLlm(jobId, jobRef) {
    const MAX_POLLS = 25;
    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const updated = await ApiClient.pollJob(jobId);
        if (updated.status === "completed" && updated.result) {
          jobRef.result = updated.result;
          this.ui.renderResult(jobRef);
          this.ui.setStatus("分析完成", "success");
          this.ui.showToast("AI 增强分析已完成", "success");
          return;
        }
      } catch {
        // silently retry
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    this.ui.setStatus("分析完成(规则引擎)", "success");
    this.ui.showToast("AI 增强分析超时，已使用规则引擎报告", "warning");
  }

  handleSelectedFile(file) {
    this.selectedFile = file;
    this.ui.renderSelectedFile(file);
  }

  startScannerAnimation() {
    const targets = [
      "合同条款 · 单方控制权检测", "合同条款 · 赔偿责任分析", "合同条款 · 知识产权归属",
      "合同条款 · 争议解决条款", "合同条款 · 保密与数据保护", "广告文案 · 绝对化用语过滤",
      "广告文案 · 保证性承诺识别", "广告文案 · 虚假权威背书", "广告文案 · 价格欺诈检测",
      "合同条款 · 缺失保护扫描", "广告文案 · AI生成内容标识", "合同条款 · 不可抗力条款"
    ];
    const categories = ["单方控制", "赔偿责任", "知识产权", "争议解决", "保密与数据", "交付验收", "续约期限", "不可抗力"];
    const findings = [
      "⚡ 检出: 最终解释权归甲方所有", "⚡ 检出: 已付款项概不退还", "⚡ 检出: 乙方承担全部损失",
      "⚡ 检出: 单方随时修改本合同", "⚡ 发现: 缺失赔偿上限条款", "⚡ 发现: 缺失保密条款",
      "⚡ 检出: 知识产权全额转让", "⚡ 检出: 由甲方所在地法院管辖"
    ];

    let targetIdx = 0;
    const progressBar = document.getElementById("scannerProgressBar");
    const targetEl = document.getElementById("scannerTarget");
    const percentEl = document.getElementById("scannerPercent");
    const findingsEl = document.getElementById("scannerFindings");
    const categoriesEl = document.getElementById("scannerCategories");

    // Init categories
    if (categoriesEl) {
      categoriesEl.innerHTML = categories.map(c => `<span class="scanner-cat">${c}</span>`).join("");
    }

    // Cycle targets and progress
    setInterval(() => {
      if (targetEl) targetEl.textContent = targets[targetIdx % targets.length];
      targetIdx++;
    }, 2200);

    // Pulse progress 0→100 cycle
    let progress = 0;
    setInterval(() => {
      progress = (progress + 1) % 100;
      if (progressBar) progressBar.style.width = progress + "%";
      if (percentEl) percentEl.textContent = progress + "%";
    }, 300);

    // Pop random findings every 2.5s
    setInterval(() => {
      if (!findingsEl) return;
      const f = findings[Math.floor(Math.random() * findings.length)];
      const el = document.createElement("div");
      el.className = "scanner-finding";
      el.textContent = f;
      findingsEl.prepend(el);
      if (findingsEl.children.length > 4) findingsEl.lastChild.remove();
      // Animate a random category to "done"
      if (categoriesEl) {
        const cats = categoriesEl.querySelectorAll(".scanner-cat:not(.done)");
        if (cats.length) {
          const randCat = cats[Math.floor(Math.random() * cats.length)];
          randCat.classList.add("done");
        }
      }
    }, 2500);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  app.init();
});
