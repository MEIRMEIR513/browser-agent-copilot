import { CopilotClient, defineTool } from "@github/copilot-sdk";

export class CopilotProvider {
  constructor(gitHubToken = null) {
    this.client = null;
    this.session = null;
    this.gitHubToken = gitHubToken;
    this.browserHandlers = null;
  }

  async initialize(browserHandlers) {
    this.browserHandlers = browserHandlers;

    const clientConfig = this.gitHubToken
      ? { gitHubToken: this.gitHubToken, useLoggedInUser: false }
      : {};

    this.client = new CopilotClient(clientConfig);
    await this.client.start();
  }

  defineBrowserTools() {
    const tools = [
      defineTool("navigate", {
        description: "Open an http or https URL in the current browser tab.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to navigate to" }
          },
          required: ["url"]
        },
        handler: async ({ url }) => {
          const result = await this.browserHandlers.navigate(url);
          return result;
        }
      }),

      defineTool("inspect_page", {
        description: "Read the current page title, URL, visible text, and interactive element selectors.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          const result = await this.browserHandlers.inspectPage();
          return result;
        }
      }),

      defineTool("click", {
        description: "Click an element using a CSS selector from the current page.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for the element to click" }
          },
          required: ["selector"]
        },
        handler: async ({ selector }) => {
          const result = await this.browserHandlers.click(selector);
          return result;
        }
      }),

      defineTool("type_text", {
        description: "Fill or type text into a visible field using a CSS selector. Never enter secrets unless the user explicitly provided them in chat.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for the field" },
            text: { type: "string", description: "Text to type" },
            submit: { type: "boolean", description: "If true, submits the nearest form and requires user approval." }
          },
          required: ["selector", "text"]
        },
        handler: async ({ selector, text, submit }) => {
          const result = await this.browserHandlers.typeText(selector, text, submit);
          return result;
        }
      }),

      defineTool("scroll_page", {
        description: "Scroll the page by a relative amount.",
        parameters: {
          type: "object",
          properties: {
            direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
            amount: { type: "integer", description: "Amount to scroll in pixels" }
          },
          required: ["direction"]
        },
        handler: async ({ direction, amount = 300 }) => {
          const result = await this.browserHandlers.scrollPage(direction, amount);
          return result;
        }
      })
    ];

    return tools;
  }

  async createSession(model = "auto", screenshot = null) {
    const tools = this.defineBrowserTools();

    const sessionConfig = {
      model,
      tools
    };

    this.session = await this.client.createSession(sessionConfig);

    return this.session;
  }

  async sendMessage(prompt, screenshot = null) {
    if (!this.session) {
      throw new Error("Session not created. Call createSession first.");
    }

    let fullPrompt = prompt;
    if (screenshot) {
      fullPrompt = `${prompt}\n\nCurrent browser screenshot is available as an image attachment.`;
    }

    const response = await this.session.sendAndWait({ prompt: fullPrompt });

    return {
      text: response?.data?.content || "",
      toolCalls: this.extractToolCalls(response)
    };
  }

  extractToolCalls(response) {
    // Copilot SDK returns tool calls in a different format
    // We need to extract them from the response
    if (!response?.data?.toolCalls) return [];

    return response.data.toolCalls.map((call, index) => ({
      id: call.id || `copilot-${Date.now()}-${index}`,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments || {})
      }
    }));
  }

  async destroy() {
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
