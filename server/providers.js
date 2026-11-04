import { modelSupportsVision } from "./safety.js";

export const providers = [
  { id: "devin", name: "Devin CLI" }
];

const environmentKeyNames = {
  devin: "DEVIN_AUTH_TOKEN"
};

export function resolveApiKey(provider, suppliedKey = "") {
  const uiKey = typeof suppliedKey === "string" ? suppliedKey.trim() : "";
  return uiKey || process.env[environmentKeyNames[provider]] || "";
}

export function providersWithKeyStatus() {
  return providers.map((provider) => ({
    ...provider,
    hasEnvironmentKey: Boolean(resolveApiKey(provider.id))
  }));
}

export async function discoverModels(provider, apiKey) {
  if (provider === "devin") {
    // Devin CLI has its own model discovery
    // Return common models that Devin supports
    return [
      { id: "adaptive", name: "Adaptive (Recommended)" },
      { id: "swe-2", name: "SWE-2" },
      { id: "swe-1.6", name: "SWE-1.6" },
      { id: "opus", name: "Claude Opus" },
      { id: "sonnet", name: "Claude Sonnet" },
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-4o", name: "GPT-4o" }
    ];
  }
  throw new Error("Unknown model provider.");
}

const browserTools = [
  {
    name: "navigate",
    description: "Open an http or https URL in the current browser tab.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
  },
  {
    name: "inspect_page",
    description: "Read the current page title, URL, visible text, and interactive element selectors.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "click",
    description: "Click an element using a CSS selector from the current page.",
    parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }
  },
  {
    name: "type_text",
    description: "Fill or type text into a visible field using a CSS selector. Never enter secrets unless the user explicitly provided them in chat.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean", description: "If true, submits the nearest form and requires user approval." }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "scroll_page",
    description: "Scroll the page by a relative amount.",
    parameters: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "integer" } }, required: ["direction" }
  }
];

export function getToolNames() {
  return browserTools.map((tool) => tool.name);
}

export function shouldSendScreenshot(provider, model, catalogVision = false) {
  return catalogVision || modelSupportsVision(provider, model);
}
