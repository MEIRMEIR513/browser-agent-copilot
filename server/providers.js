import { CopilotProvider } from "./copilot-provider.js";

export const providers = [
  { id: "copilot", name: "GitHub Copilot" }
];

const environmentKeyNames = {
  copilot: "COPILOT_GITHUB_TOKEN"
};

export function resolveApiKey(provider, suppliedKey = "") {
  const uiKey = typeof suppliedKey === "string" ? suppliedKey.trim() : "";
  return uiKey || process.env[environmentKeyNames[provider]] ||
    (provider === "copilot" ? process.env.GITHUB_TOKEN : "");
}

export function providersWithKeyStatus() {
  return providers.map((provider) => ({
    ...provider,
    hasEnvironmentKey: Boolean(resolveApiKey(provider.id))
  }));
}

export async function discoverModels(provider, apiKey) {
  if (provider === "copilot") {
    // Copilot SDK handles model discovery internally
    // Return a placeholder list that will be replaced by the SDK
    return [
      { id: "auto", name: "Auto (Recommended)" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" }
    ];
  }
  throw new Error("Unknown model provider.");
}

export function getToolNames() {
  return ["navigate", "inspect_page", "click", "type_text", "scroll_page"];
}

export function shouldSendScreenshot(provider, model, catalogVision = false) {
  // Copilot SDK handles vision automatically for supported models
  return catalogVision || ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet"].includes(model);
}

export { CopilotProvider };
