// public/js/main.js
import { sampleTexts } from './utils.js';
import { ApiClient } from './api.js';
import { UIManager } from './ui.js';

class App {
  constructor() {
    this.ui = new UIManager();
    this.activeMode = "ad_copy";
    this.activeJobId = null;
    this.allowedUploads = [".txt", ".md"];
  }

  async init() {
    this.ui.updateMode(this.activeMode);
    this.bindEvents();
    
    this.ui.setStatus("系统初始化中...", "processing");
    try {
      const meta = await ApiClient.fetchMeta();
      this.ui.renderMeta(meta);
      if (meta.allowed_uploads) this.allowedUploads = meta.allowed_uploads;
      
      await this.refreshJobs(true);
      this.ui.setStatus("系统就绪", "success");
    } catch (e) {
      this.ui.setStatus("初始化存在警告", "error");
      this.ui.showToast(e.message, 'error');
    }
  }

  async refreshJobs(silent = false) {
    try {
      const jobs = await ApiClient.fetchJobs(this.ui.dom.apiKeyInput.value);
      this.ui.renderRecentJobs(jobs, this.activeJobId, this.loadJob.bind(this));
    } catch (e) {
      this.ui.dom.recentJobs.innerHTML = `<div class="empty-state-small">${e.message}</div>`;
      if (!silent) this.ui.showToast(e.message, 'error');
    }
  }

  async loadJob(jobId) {
    this.activeJobId = jobId;
    this.ui.setStatus("加载报告中...", "processing");
    try {
      const payload = await ApiClient.loadJob(jobId, this.ui.dom.apiKeyInput.value);
      await this.refreshJobs(true);
      this.ui.renderResult(payload);
      this.ui.setStatus("报告已加载", "success");
      document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      this.ui.setStatus("加载失败", "error");
      this.ui.showToast(e.message, 'error');
    }
  }

  async submitText() {
    const text = this.ui.dom.textInput.value.trim();
    const title = this.ui.dom.titleInput.value.trim() || null;
    
    if (!text) {
      this.ui.showToast("请输入待扫描内容", "error");
      return;
    }

    this.ui.setStatus("深度分析中...", "processing");
    try {
      const payload = await ApiClient.submitText({
        mode: this.activeMode,
        text,
        title,
        use_llm: this.ui.dom.useLlmText.checked
      }, this.ui.dom.apiKeyInput.value);
      
      this.activeJobId = payload.job_id;
      this.ui.renderResult({ id: payload.job_id, title: title || payload.result?.title, result: payload.result });
      await this.refreshJobs(true);
      this.ui.setStatus("分析完成", "success");
      this.ui.showToast("报告生成完毕", "success");
      document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      this.ui.setStatus("提交失败", "error");
      this.ui.showToast(e.message, 'error');
    }
  }

  async submitFile() {
    const file = this.ui.dom.fileInput.files?.[0];
    const title = this.ui.dom.titleInput.value.trim() || null;
    
    if (!file) {
      this.ui.showToast("请选择文件", "error");
      return;
    }
    
    const suffix = \`.\${file.name.split(".").pop() || ""}\`.toLowerCase();
    if (!this.allowedUploads.includes(suffix)) {
      this.ui.showToast(\`不支持的文件格式。仅支持：\${this.allowedUploads.join("、")}\`, "error");
      return;
    }

    this.ui.setStatus("文件上传并解析中...", "processing");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", this.activeMode);
    formData.append("title", title || "");
    formData.append("use_llm", String(this.ui.dom.useLlmFile.checked));

    try {
      const payload = await ApiClient.submitFile(formData, this.ui.dom.apiKeyInput.value);
      this.activeJobId = payload.job_id;
      this.ui.renderResult({ id: payload.job_id, title: title || payload.result?.title, result: payload.result });
      await this.refreshJobs(true);
      this.ui.setStatus("分析完成", "success");
      this.ui.showToast("报告生成完毕", "success");
      document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      this.ui.setStatus("上传失败", "error");
      this.ui.showToast(e.message, 'error');
    }
  }

  bindEvents() {
    this.ui.dom.modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        this.activeMode = btn.dataset.mode;
        this.ui.updateMode(this.activeMode);
      });
    });

    this.ui.dom.paneButtons.forEach(btn => {
      btn.addEventListener("click", () => this.ui.switchPane(btn.dataset.pane));
    });

    this.ui.dom.fillSampleBtn.addEventListener("click", () => {
      this.ui.dom.textInput.value = sampleTexts[this.activeMode];
      this.ui.switchPane("textPane");
      this.ui.showToast("示例内容已载入", "success");
    });

    document.getElementById("clearTextBtn").addEventListener("click", () => {
      this.ui.dom.textInput.value = "";
      this.ui.showToast("内容已清空", "info");
    });

    this.ui.dom.scanTextBtn.addEventListener("click", this.submitText.bind(this));
    this.ui.dom.scanFileBtn.addEventListener("click", this.submitFile.bind(this));
    
    this.ui.dom.refreshBtn.addEventListener("click", async () => {
      this.ui.setStatus("刷新状态中...", "processing");
      await this.refreshJobs();
      this.ui.setStatus("系统就绪", "success");
      this.ui.showToast("任务列表已刷新", "success");
    });

    // Drag & Drop
    const { fileDropZone, fileInput } = this.ui.dom;
    if (fileDropZone) {
      fileDropZone.addEventListener('dragover', e => { e.preventDefault(); fileDropZone.classList.add('drag-over'); });
      fileDropZone.addEventListener('dragleave', e => { e.preventDefault(); fileDropZone.classList.remove('drag-over'); });
      fileDropZone.addEventListener('drop', e => {
        e.preventDefault();
        fileDropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          this.updateFileDisplay();
        }
      });
      fileInput.addEventListener('change', this.updateFileDisplay.bind(this));
    }
  }

  updateFileDisplay() {
    const file = this.ui.dom.fileInput.files?.[0];
    if (file) {
      this.ui.dom.uploadHelpText.textContent = \`已选择: \${file.name} (\${(file.size / 1024).toFixed(1)} KB)\`;
      this.ui.dom.uploadHelpText.style.color = 'var(--accent-blue)';
      this.ui.dom.uploadHelpText.style.fontWeight = '600';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
