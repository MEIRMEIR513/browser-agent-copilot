import { spawn } from "node:child_process";

export class DevinProvider {
  constructor() {
    this.model = null; // Let Devin use its default model
    this.permissionMode = "normal";
  }

  async sendMessage(prompt, snapshot = null) {
    return new Promise((resolve, reject) => {
      let fullPrompt = prompt;

      if (snapshot) {
        fullPrompt = `${prompt}\n\nCurrent browser state:\n${JSON.stringify(snapshot)}`;
      }

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
    // Try to parse tool calls from Devin's output
    // This is a simple implementation - in production you'd need better parsing
    const toolCalls = [];

    // Look for patterns like "I'll execute: <command>" or similar
    const patterns = [
      /I'll execute:?\s*(.+)/gi,
      /Running:\s*(.+)/gi,
      /Execute:\s*(.+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        toolCalls.push({
          id: `devin-${Date.now()}-${toolCalls.length}`,
          type: "function",
          function: {
            name: "exec",
            arguments: JSON.stringify({ command: match[1] })
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
