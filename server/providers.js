import { modelSupportsVision, parseModelList } from "./safety.js";

const providerConfig = {
  github: {
    label: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    authHeader: "Bearer"
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "Bearer"
  }
};

export const providers = Object.entries(providerConfig).map(([id, item]) => ({
  id,
  name: item.label
})).concat({ id: "gemini", name: "Google Gemini" });

const environmentKeyNames = {
  github: "GITHUB_MODELS_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY"
};

export function resolveApiKey(provider, suppliedKey = "") {
  const uiKey = typeof suppliedKey === "string" ? suppliedKey.trim() : "";
  return uiKey || process.env[environmentKeyNames[provider]] ||
    (provider === "gemini" ? process.env.GOOGLE_API_KEY : "") ||
    (provider === "github" ? process.env.GITHUB_TOKEN : "");
}

export function providersWithKeyStatus() {
  return providers.map((provider) => ({
    ...provider,
    hasEnvironmentKey: Boolean(resolveApiKey(provider.id))
  }));
}

async function readJson(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Provider returned an invalid JSON response.");
  }
}

export async function discoverModels(provider, apiKey) {
  if (!apiKey?.trim()) throw new Error("Enter an API key to discover available models.");
  if (provider === "gemini") {
    const allModels = [];
    let pageToken = "";
    const seenTokens = new Set();
    do {
      const query = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const payload = await readJson(await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?${query}`,
        { headers: { "x-goog-api-key": apiKey } }
      ));
      allModels.push(...(payload.models ?? []));
      pageToken = payload.nextPageToken ?? "";
      if (pageToken && seenTokens.has(pageToken)) throw new Error("Gemini model catalog returned a repeated page token.");
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return parseModelList(allModels)
      .filter((item) => allModels.some((raw) => raw.name === `models/${item.id}` && raw.supportedGenerationMethods?.includes("generateContent")));
  }

  const config = providerConfig[provider];
  if (!config) throw new Error("Unknown model provider.");
  const headers = { Authorization: `${config.authHeader} ${apiKey}`, Accept: "application/json" };
  if (provider === "github") {
    const catalogUrls = [
      "https://models.github.ai/catalog/models",
      "https://models.github.ai/inference/models"
    ];
    for (const url of catalogUrls) {
      try {
        const payload = await readJson(await fetch(url, { headers }));
        const models = parseModelList(payload);
        if (models.length) return models;
      } catch {
        // Try the inference service's standard model-list endpoint below.
      }
    }
  }
  const payload = await readJson(await fetch(`${config.baseUrl}/models`, { headers }));
  return parseModelList(payload);
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
    parameters: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "integer" } }, required: ["direction"] }
  }
];

export function getToolSchemas(provider) {
  if (provider === "gemini") {
    return [{
      function_declarations: browserTools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters
      }))
    }];
  }
  return browserTools.map(({ name, description, parameters }) => ({
    type: "function",
    function: { name, description, parameters }
  }));
}

export function getToolNames() {
  return browserTools.map((tool) => tool.name);
}

function openAiMessages(messages, screenshot) {
  const converted = messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
    if (message.role === "assistant" && message.tool_calls) return message;
    return { role: message.role, content: message.content };
  });
  if (screenshot) converted.push({
    role: "user",
    content: [
      { type: "text", text: "Current browser screenshot. Use it to understand the current page visually." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
    ]
  });
  return converted;
}

function geminiContents(messages, screenshot) {
  const contents = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const previous = contents.at(-1);
      const responsePart = {
        functionResponse: { name: message.name, response: { result: message.content } }
      };
      if (previous?.role === "user") previous.parts.push(responsePart);
      else contents.push({ role: "user", parts: [responsePart] });
      continue;
    }
    const role = message.role === "assistant" ? "model" : "user";
    if (role === "model" && message.geminiParts) {
      contents.push({ role: "model", parts: message.geminiParts });
      continue;
    }
    if (role === "model" && message.tool_calls) {
      contents.push({
        role: "model",
        parts: message.tool_calls.map((call) => ({
          functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments || "{}") }
        }))
      });
      continue;
    }
    const parts = [{ text: message.content ?? "" }];
    const previous = contents.at(-1);
    if (previous?.role === role && role === "user") previous.parts.push(...parts);
    else contents.push({ role, parts });
  }
  if (screenshot) {
    const previous = contents.at(-1);
    const screenshotParts = [
      { text: "Current browser screenshot. Use it to understand the current page visually." },
      { inline_data: { mime_type: "image/jpeg", data: screenshot } }
    ];
    if (previous?.role === "user") previous.parts.push(...screenshotParts);
    else contents.push({ role: "user", parts: screenshotParts });
  }
  return contents;
}

export async function completeTurn({ provider, model, apiKey, messages, signal, screenshot }) {
  if (provider === "gemini") {
    const system = messages.find((message) => message.role === "system")?.content;
    const contents = geminiContents(messages, screenshot);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal,
        body: JSON.stringify({
          ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
          contents,
          tools: getToolSchemas(provider),
          tool_config: { function_calling_config: { mode: "AUTO" } }
        })
      }
    );
    const payload = await readJson(response);
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((part) => part.text).map((part) => part.text).join("\n");
    const calls = parts.filter((part) => part.functionCall).map((part, i) => {
      const providerName = part.functionCall.name;
      const name = providerName.includes(":") ? providerName.slice(providerName.lastIndexOf(":") + 1) : providerName;
      return {
        id: `gemini-${Date.now()}-${i}`,
        type: "function",
        providerName,
        function: { name, arguments: JSON.stringify(part.functionCall.args ?? {}) }
      };
    });
    return { text, toolCalls: calls, geminiParts: parts };
  }

  const config = providerConfig[provider];
  if (!config) throw new Error("Unknown model provider.");
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal,
    body: JSON.stringify({
      model,
      messages: openAiMessages(messages, screenshot),
      tools: getToolSchemas(provider),
      tool_choice: "auto",
      stream: false
    })
  });
  const payload = await readJson(response);
  const choice = payload.choices?.[0]?.message;
  if (!choice) throw new Error("Provider returned no assistant message.");
  return { text: choice.content ?? "", toolCalls: choice.tool_calls ?? [] };
}

export function shouldSendScreenshot(provider, model, catalogVision = false) {
  return catalogVision || modelSupportsVision(provider, model);
}
