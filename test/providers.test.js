import test from "node:test";
import assert from "node:assert/strict";
import { completeTurn, discoverModels, resolveApiKey, shouldSendScreenshot } from "../server/providers.js";

test("discovers Gemini models that support generation", async () => {
  const originalFetch = global.fetch;
  const pages = [];
  global.fetch = async (url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    pages.push(String(url));
    const secondPage = String(url).includes("pageToken=");
    return new Response(JSON.stringify(secondPage ? {
      models: [{ name: "models/gemini-pro", supportedGenerationMethods: ["generateContent"], inputModalities: ["image"] }]
    } : {
      models: [
        { name: "models/gemini-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embed-text", supportedGenerationMethods: ["embedContent"] }
      ],
      nextPageToken: "page-2"
    }));
  };
  try {
    assert.deepEqual(await discoverModels("gemini", "test-key"), [
      { id: "gemini-flash", name: "Gemini Flash", vision: false },
      { id: "gemini-pro", name: "gemini-pro", vision: true }
    ]);
    assert.equal(pages.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("normalizes Gemini function calls for the agent loop", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    const request = JSON.parse(options.body);
    assert.equal(request.tools[0].function_declarations.some((tool) => tool.name === "navigate"), true);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { text: "I will open the page." },
        { functionCall: { name: "default_api:navigate", args: { url: "https://example.com" } }, thought_signature: "signed-thought-data" }
      ] } }]
    }));
  };
  try {
    const result = await completeTurn({
      provider: "gemini",
      model: "gemini-flash",
      apiKey: "test-key",
      messages: [{ role: "user", content: "Open the page" }]
    });
    assert.equal(result.text, "I will open the page.");
    assert.equal(result.toolCalls[0].function.name, "navigate");
    assert.equal(result.toolCalls[0].providerName, "default_api:navigate");
    assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { url: "https://example.com" });
    assert.equal(result.geminiParts[1].thought_signature, "signed-thought-data");
  } finally {
    global.fetch = originalFetch;
  }
});

test("preserves Gemini thought signatures and provider function names in subsequent turns", async () => {
  const originalFetch = global.fetch;
  let requestNumber = 0;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requestNumber += 1;
    if (requestNumber === 1) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [
          { text: "Opening the page." },
          {
            functionCall: { name: "default_api:navigate", args: { url: "https://example.com" } },
            thought_signature: "must-be-echoed-exactly"
          }
        ] } }]
      }));
    }
    const modelTurn = request.contents.find((item) => item.role === "model");
    assert.equal(modelTurn.parts[1].thought_signature, "must-be-echoed-exactly");
    assert.deepEqual(modelTurn.parts[1].functionCall, {
      name: "default_api:navigate",
      args: { url: "https://example.com" }
    });
    const toolReply = request.contents.find((item) => item.role === "user" && item.parts.some((part) => part.functionResponse));
    assert.equal(toolReply.parts[0].functionResponse.name, "default_api:navigate");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Page opened." }] } }] }));
  };
  try {
    const first = await completeTurn({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      apiKey: "test-key",
      messages: [{ role: "user", content: "Open example.com." }]
    });
    await completeTurn({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      apiKey: "test-key",
      messages: [
        { role: "user", content: "Open example.com." },
        {
          role: "assistant",
          content: first.text,
          tool_calls: first.toolCalls,
          geminiParts: first.geminiParts
        },
        {
          role: "tool",
          name: first.toolCalls[0].providerName,
          content: "Opened https://example.com/"
        }
      ]
    });
    assert.equal(requestNumber, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("uses provider vision metadata as well as model family heuristics", () => {
  assert.equal(shouldSendScreenshot("github", "provider-custom-model", true), true);
  assert.equal(shouldSendScreenshot("groq", "text-model", false), false);
});

test("discovers GitHub Models and Groq catalog results dynamically", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("models.github.ai/catalog")) {
      return new Response(JSON.stringify([{ id: "publisher/model-a", displayName: "Model A", vision: true }]));
    }
    return new Response(JSON.stringify({ data: [{ id: "groq-model-a" }] }));
  };
  try {
    assert.deepEqual(await discoverModels("github", "github-key"), [
      { id: "publisher/model-a", name: "Model A", vision: true }
    ]);
    assert.deepEqual(await discoverModels("groq", "groq-key"), [
      { id: "groq-model-a", name: "groq-model-a", vision: false }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("uses environment provider keys as a fallback", () => {
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "server-key";
  try {
    assert.equal(resolveApiKey("groq"), "server-key");
    assert.equal(resolveApiKey("groq", "ui-key"), "ui-key");
  } finally {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("keeps Gemini tool results together and attaches the current screenshot", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.deepEqual(request.contents.map((item) => item.role), ["user", "model", "user"]);
    const results = request.contents[2].parts.filter((part) => part.functionResponse);
    assert.equal(results.length, 2);
    assert.equal(request.contents[2].parts.at(-1).inline_data.data, "c2NyZWVuc2hvdA==");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Done." }] } }] }));
  };
  try {
    await completeTurn({
      provider: "gemini",
      model: "gemini-flash",
      apiKey: "test-key",
      screenshot: "c2NyZWVuc2hvdA==",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "Click two controls." },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "click", arguments: "{\"selector\":\"#one\"}" } },
            { function: { name: "click", arguments: "{\"selector\":\"#two\"}" } }
          ]
        },
        { role: "tool", name: "click", content: "First clicked." },
        { role: "tool", name: "click", content: "Second clicked." }
      ]
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("uses OpenAI-compatible inference endpoints for GitHub Models and Groq", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(String(url).endsWith("/chat/completions"), true);
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const request = JSON.parse(options.body);
    assert.equal(request.tools[0].type, "function");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ready.", tool_calls: [] } }] }));
  };
  try {
    for (const provider of ["github", "groq"]) {
      const result = await completeTurn({
        provider,
        model: "test-model",
        apiKey: "test-key",
        messages: [{ role: "user", content: "Ready?" }]
      });
      assert.equal(result.text, "Ready.");
    }
  } finally {
    global.fetch = originalFetch;
  }
});
