import { chromium } from "playwright";
import { assertPublicHttpUrl, needsApproval } from "./safety.js";
import { getBrowserRuntime } from "./browser-runtime.js";

const interactiveSelector = "a,button,input,textarea,select,[role=button],[role=link]";

export class BrowserSession {
  browser;
  page;
  onUpdate;
  blockedNetworkNoticeSent = false;
  activePageAction;

  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
  }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.browser) {
      const runtime = getBrowserRuntime();
      if (runtime === "bundled-linux-x64") {
        try {
          const { default: serverlessChromium } = await import("@sparticuz/chromium");
          const executablePath = await serverlessChromium.executablePath();
          this.browser = await chromium.launch({
            executablePath,
            args: [...serverlessChromium.args, "--disable-dev-shm-usage"],
            headless: true
          });
        } catch (error) {
          throw new Error(
            `Could not launch the bundled Linux Chromium: ${error.message}. ` +
            "This cloud host may not support its Linux runtime; use a Playwright Docker image."
          );
        }
      } else if (runtime === "unsupported-linux") {
        throw new Error(
          `Bundled cloud Chromium is available only for Linux x64 (detected ${process.arch}). ` +
          "Use a Playwright Docker image or install the system browser dependencies."
        );
      } else {
        try {
          this.browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage"]
          });
        } catch (error) {
          if (process.platform === "linux" && /shared librar|\\.so(?:\\.|:)/i.test(error.message)) {
            throw new Error(
              `Playwright Chromium is missing Linux system libraries: ${error.message}. ` +
              "For Linux x64, install the bundled runtime with npm install; otherwise use the Playwright Docker image."
            );
          }
          throw error;
        }
      }
    }
    this.page = await this.browser.newPage({
      viewport: { width: 1365, height: 900 },
      serviceWorkers: "block"
    });
    await this.page.route("**/*", async (route) => {
      try {
        await assertPublicHttpUrl(route.request().url());
        await route.continue();
      } catch (error) {
        if (!this.blockedNetworkNoticeSent) {
          this.blockedNetworkNoticeSent = true;
          this.onUpdate({ warning: `Blocked a page request: ${error.message}` });
        }
        await route.abort("blockedbyclient");
      }
    });
    this.page.on("load", () => this.publish());
    this.page.on("domcontentloaded", () => this.publish());
    return this.page;
  }

  async publish() {
    try {
      const [snapshot, screenshot] = await Promise.all([this.snapshot(), this.screenshot()]);
      this.onUpdate({ snapshot, screenshot });
    } catch (error) {
      if (!this.page || this.page.isClosed()) return;
      this.onUpdate({ warning: `Could not refresh the browser preview: ${error.message}` });
    }
  }

  async snapshot() {
    if (!this.page || this.page.isClosed()) return { url: "", title: "", text: "", elements: [] };
    return this.page.evaluate((selector) => {
      const bodyText = document.body?.innerText ?? "";
      const elements = [...document.querySelectorAll(selector)].slice(0, 100).map((element, index) => {
        const label = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("placeholder") || element.value || element.tagName).trim().replace(/\s+/g, " ").slice(0, 120);
        if (!element.dataset.agentSelector) element.dataset.agentSelector = `agent-${index}`;
        return {
          selector: `[data-agent-selector="${element.dataset.agentSelector}"]`,
          tag: element.tagName.toLowerCase(),
          label,
          type: element.getAttribute("type") || "",
          disabled: Boolean(element.disabled)
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: bodyText.slice(0, 12000),
        elements
      };
    }, interactiveSelector);
  }

  async screenshot() {
    if (!this.page || this.page.isClosed()) return "";
    const image = await this.page.screenshot({ type: "jpeg", quality: 65, fullPage: false });
    return image.toString("base64");
  }

  async performPageAction(page, action, signal) {
    if (signal?.aborted) throw new Error("Browser action cancelled.");
    this.activePageAction = page;
    try {
      return await action();
    } finally {
      if (this.activePageAction === page) this.activePageAction = undefined;
    }
  }

  async cancelPendingAction() {
    const page = this.activePageAction;
    if (!page) return;
    this.activePageAction = undefined;
    if (this.page === page) this.page = undefined;
    await page.close();
  }

  async execute(name, args, requestApproval, signal) {
    const page = await this.ensurePage();
    if (name === "navigate") {
      const url = await assertPublicHttpUrl(args.url);
      await this.performPageAction(page, () =>
        page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }),
        signal
      );
      await this.publish();
      return `Opened ${page.url()}`;
    }
    if (name === "inspect_page") {
      const snapshot = await this.performPageAction(page, () => this.snapshot(), signal);
      return JSON.stringify(snapshot);
    }
    if (name === "scroll_page") {
      const amount = Math.max(100, Math.min(1200, Number(args.amount) || 600));
      await this.performPageAction(page, () =>
        page.evaluate((y) => window.scrollBy(0, y), args.direction === "up" ? -amount : amount),
        signal
      );
      await this.publish();
      return `Scrolled ${args.direction === "up" ? "up" : "down"} by ${amount}px.`;
    }
    if (name === "click") {
      const target = page.locator(args.selector).first();
      const info = await this.performPageAction(page, async () => {
        await target.waitFor({ state: "visible", timeout: 5000 });
        return target.evaluate((element) => ({
          label: (element.getAttribute("aria-label") || element.innerText || element.value || "").trim().slice(0, 200),
          submit: element.tagName === "INPUT" && ["submit", "image"].includes(element.type) ||
            element.tagName === "BUTTON" && (element.type === "submit" || Boolean(element.closest("form")) && element.type !== "button")
        }));
      }, signal);
      if (needsApproval(info) && !(await requestApproval(`Click “${info.label || args.selector}”`))) {
        return "The user declined this action.";
      }
      await this.performPageAction(page, async () => {
        await target.click({ timeout: 5000 });
        await page.waitForTimeout(350);
      }, signal);
      await this.publish();
      return `Clicked ${info.label || args.selector}.`;
    }
    if (name === "type_text") {
      const target = page.locator(args.selector).first();
      const type = await this.performPageAction(page, async () => {
        await target.waitFor({ state: "visible", timeout: 5000 });
        return target.getAttribute("type");
      }, signal);
      if (type === "password") throw new Error("Typing into password fields is disabled for safety.");
      if (args.submit) {
        if (!(await requestApproval("Submit the current form"))) return "The user declined form submission.";
      }
      await this.performPageAction(page, async () => {
        await target.fill(String(args.text ?? ""));
        if (args.submit) {
          await target.press("Enter");
          await page.waitForTimeout(350);
        }
      }, signal);
      await this.publish();
      return args.submit ? "Filled the field and submitted the form." : "Filled the field.";
    }
    throw new Error(`Unsupported browser action: ${name}`);
  }

  async close() {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }
}
