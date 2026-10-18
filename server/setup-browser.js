import { getBrowserRuntime } from "./browser-runtime.js";
import { spawn } from "node:child_process";

const runtime = getBrowserRuntime();
if (runtime === "bundled-linux-x64") {
  console.log("Linux x64 detected. Chromium and its serverless runtime libraries are included in the installed package.");
  process.exit(0);
}

const result = spawn("npx", ["playwright", "install", "chromium"], { stdio: "inherit", shell: process.platform === "win32" });
result.on("error", (error) => {
  console.error(`Could not run Playwright browser installation: ${error.message}`);
  process.exitCode = 1;
});
result.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
