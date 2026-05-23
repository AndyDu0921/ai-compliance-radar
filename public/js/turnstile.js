// public/js/turnstile.js
export class TurnstileManager {
  constructor() {
    this.tokens = { text: null, file: null };
    this.widgetIds = { text: null, file: null };
    this.enabled = false;
    this.siteKey = null;
  }

  configure(enabled, siteKey) {
    this.enabled = enabled && Boolean(siteKey);
    this.siteKey = siteKey || null;
  }

  async setup(containers) {
    if (!this.enabled || !this.siteKey) return;

    await ensureTurnstileScript();

    if (containers.text) {
      this.mountWidget("text", containers.text);
    }
    if (containers.file) {
      this.mountWidget("file", containers.file);
    }
  }

  mountWidget(kind, container) {
    if (!container || !window.turnstile || this.widgetIds[kind] !== null) return;

    this.widgetIds[kind] = window.turnstile.render(container, {
      sitekey: this.siteKey,
      theme: "dark",
      callback: (token) => {
        this.tokens[kind] = token;
      },
      "expired-callback": () => {
        this.tokens[kind] = null;
      },
      "error-callback": () => {
        this.tokens[kind] = null;
      }
    });
  }

  reset(kind) {
    this.tokens[kind] = null;
    if (window.turnstile && this.widgetIds[kind] !== null) {
      window.turnstile.reset(this.widgetIds[kind]);
    }
  }

  getToken(kind) {
    return this.tokens[kind];
  }

  isRequired() {
    return this.enabled;
  }
}

function ensureTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileLoader) return window.__turnstileLoader;

  window.__turnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile 脚本加载失败"));
    document.head.appendChild(script);
  });

  return window.__turnstileLoader;
}
