import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { AgentRun } from "./agent.js";
import { BrowserSession } from "./browser.js";
import { discoverModels, providersWithKeyStatus, resolveApiKey } from "./providers.js";

const app = express();
const server = createServer(app);
const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "1mb" }));
app.get("/api/providers", (_req, res) => res.json(providersWithKeyStatus()));
app.post("/api/models", async (req, res) => {
  try {
    const { provider, apiKey } = req.body ?? {};
    res.json({ models: await discoverModels(provider, resolveApiKey(provider, apiKey)) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(root, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/socket") {
    socket.destroy();
    return;
  }
  socketServer.handleUpgrade(request, socket, head, (ws) => socketServer.emit("connection", ws, request));
});

socketServer.on("connection", (ws) => {
  let config = null;
  let activeRun = null;
  const browser = new BrowserSession((update) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "browser_update", ...update }));
  });
  ws.send(JSON.stringify({ type: "providers", providers: providersWithKeyStatus() }));
  Promise.all([browser.snapshot(), browser.screenshot()]).then(([snapshot, screenshot]) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "browser_update", snapshot, screenshot }));
  });

  ws.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid WebSocket message." }));
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      ws.send(JSON.stringify({ type: "error", message: "WebSocket messages must be JSON objects." }));
      return;
    }
    if (message.type === "configure") {
      if (!["devin"].includes(message.provider) || !message.model) {
        ws.send(JSON.stringify({ type: "error", message: "Choose a provider and model. Devin CLI must be installed and authenticated." }));
        return;
      }
      config = { provider: message.provider, model: message.model, apiKey: "", vision: Boolean(message.vision) };
      ws.send(JSON.stringify({ type: "configured", provider: config.provider, model: config.model }));
      return;
    }
    if (message.type === "chat") {
      const text = String(message.content ?? "").trim();
      if (!text) return;
      if (!config) {
        ws.send(JSON.stringify({ type: "error", message: "Configure a provider and model before chatting." }));
        return;
      }
      if (activeRun?.running) {
        if (activeRun.stopped) {
          ws.send(JSON.stringify({ type: "error", message: "The current run is stopping. Try again in a moment." }));
          return;
        }
        activeRun.addUserMessage(text);
        ws.send(JSON.stringify({ type: "message", role: "user", content: text }));
        return;
      }
      activeRun = new AgentRun({ socket: ws, browser, config });
      ws.send(JSON.stringify({ type: "message", role: "user", content: text }));
      void activeRun.run(text);
      return;
    }
    if (message.type === "approval" && activeRun) {
      activeRun.resolveApproval(message.id, message.approved);
      return;
    }
    if (message.type === "stop" && activeRun) activeRun.stop();
  });

  ws.on("close", async () => {
    activeRun?.stop();
    try {
      await browser.close();
    } catch (error) {
      console.error(`Failed to close browser session: ${error.message}`);
    }
  });
});

server.listen(port, host, () => {
  console.log(`Browser Agent listening on http://${host}:${port}`);
});

const shutdown = async () => {
  for (const client of socketServer.clients) client.close();
  server.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
