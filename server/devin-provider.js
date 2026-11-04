import { spawn } from "node:child_process";

export class DevinProvider {
  constructor() {
    this.model = null; // Let Devin use its default model
    this.permissionMode = "normal";
  }

  async sendMessage(prompt, snapshot = null) {
    return new Promise((resolve, reject) => {
      let fullPrompt = `You are a browser agent assistant. I will provide you with the current browser state and your task.\n\n`;
      fullPrompt += `Your task: ${prompt}\n\n`;

      if (snapshot) {
        fullPrompt += `Current browser state:\n`;
        fullPrompt += `URL: ${snapshot.url}\n`;
        fullPrompt += `Title: ${snapshot.title}\n`;
        fullPrompt += `Page text: ${snapshot.text}\n\n`;
        fullPrompt += `Interactive elements:\n`;
        snapshot.elements.forEach((el, i) => {
          fullPrompt += `${i + 1}. ${el.tag} - ${el.label} (selector: ${el.selector})\n`;
        });
      }

      fullPrompt += `\n\nBased on this information, tell me what browser actions you would take. Format your response as a list of actions like:\n`;
      fullPrompt += `1. navigate(url)\n`;
      fullPrompt += `2. click(selector)\n`;
      fullPrompt += `3. type_text(selector, text)\n`;
      fullPrompt += `4. scroll_page(direction)\n\n`;
      fullPrompt += `I will execute these actions in the actual browser.\n`;

      const args = ["-p", fullPrompt];

      // Only add model flag if explicitly set and not default
      if (this.model && this.model !== "adaptive") {
        args.unshift("--model", this.model);
      }

      if (this.permissionMode) {
        args.unshift("--permission-mode", this.permissionMode);
      }

      const devin = spawn("devin", args, {
        shell: false
      });

      let output = "";
      let errorOutput = "";

      devin.stdout.on("data", (data) => {
        output += data.toString();
      });

      devin.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      devin.on("close", (code) => {
        if (code === 0) {
          resolve({
            text: output.trim(),
            toolCalls: this.parseToolCalls(output)
          });
        } else {
          reject(new Error(`Devin CLI exited with code ${code}: ${errorOutput}`));
        }
      });

      devin.on("error", (error) => {
        reject(new Error(`Failed to spawn Devin CLI: ${error.message}`));
      });
    });
  }

  parseToolCalls(output) {
    // Parse Devin's response to extract browser actions
    const toolCalls = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Look for numbered list format: "1. navigate(url)"
      const numberedMatch = line.match(/^\d+\.\s*(\w+)\(([^)]*)\)/);
      if (numberedMatch) {
        const action = numberedMatch[1];
        const argsStr = numberedMatch[2];
        
        let args = {};
        if (action === 'navigate') {
          args = { url: argsStr.trim() };
        } else if (action === 'click') {
          args = { selector: argsStr.trim() };
        } else if (action === 'type_text') {
          const parts = argsStr.split(',').map(s => s.trim());
          args = { selector: parts[0].replace(/['"]/g, ''), text: parts[1]?.replace(/['"]/g, '') || '' };
        } else if (action === 'scroll_page') {
          const parts = argsStr.split(',').map(s => s.trim());
          args = { direction: parts[0]?.replace(/['"]/g, ''), amount: parseInt(parts[1]) || 300 };
        }

        toolCalls.push({
          id: `devin-${Date.now()}-${toolCalls.length}`,
          type: "function",
          function: {
            name: action,
            arguments: JSON.stringify(args)
          }
        });
      }

      // Look for navigate with URL anywhere in the line
      const urlMatch = line.match(/navigate\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/i);
      if (urlMatch) {
        toolCalls.push({
          id: `devin-${Date.now()}-${toolCalls.length}`,
          type: "function",
          function: {
            name: "navigate",
            arguments: JSON.stringify({ url: urlMatch[1] })
          }
        });
      }

      // Also look for: "navigate to URL" format
      const navMatch = line.match(/navigate\s+(?:to\s+)?(https?:\/\/[^\s]+)/i);
      if (navMatch) {
        toolCalls.push({
          id: `devin-${Date.now()}-${toolCalls.length}`,
          type: "function",
          function: {
            name: "navigate",
            arguments: JSON.stringify({ url: navMatch[1].trim() })
          }
        });
      }
    }

    return toolCalls;
  }

  setModel(model) {
    this.model = model;
  }

  setPermissionMode(mode) {
    this.permissionMode = mode;
  }
}
