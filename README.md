# Browser Agent

A local-first conversational browser agent. It controls one real, persistent Chromium tab with Playwright, reads the rendered page and accessible interactive elements, and shows a live screenshot and page summary in the UI. The model chooses the next action from browser tools; this is not a generated-script-per-task design.

## Run locally

Requirements: Node.js 20+ and npm.

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The UI and API keys remain in browser/server memory for the active session; API keys are not written to disk or browser storage.

To run the production app locally:

```powershell
npm run build
npm start
```

The server listens on port `3001` by default (`PORT` can override it).

## Run from a terminal only

No visible browser, local browser window, or forwarded web port is required. The agent uses headless Chromium and prompts for the provider, a hidden API key, and a model directly in the terminal:

```sh
npm run setup:browser
npm run cli
```

On Linux x64, `@sparticuz/chromium` supplies a packaged headless browser and its serverless Linux libraries, so no `sudo`, OS package manager, or visible browser is needed. This package is pinned to Chromium 138 for compatibility with Playwright 1.53 and requires Node.js 20.11+. Linux ARM and Linux hosts with incompatible system libraries are not covered by the packaged runtime; use the included Playwright Docker image or ask the cloud provider to supply browser dependencies. Windows and macOS use Playwright's regular Chromium installation.

Type tasks at `אתה>`. During a run, another line is treated as an extra instruction; answer `כן` only when you approve a consequential action. Use `/עצור` to stop the current run, `/עזרה` for terminal commands, or `/יציאה` to close the agent. The provider key is only held in memory for the current run.

Gemini tool calls are replayed with their original provider metadata, including `thought_signature`, as required by Gemini's function-calling API.

## Providers and model discovery

This project now uses the **GitHub Copilot SDK** for AI model integration. The app queries the provider's model catalog rather than maintaining a fixed model list.

| Provider | Key | Discovery / inference |
| --- | --- | --- |
| GitHub Copilot | GitHub OAuth token or `COPILOT_GITHUB_TOKEN` | Copilot SDK with GitHub Copilot subscription or BYOK |

### GitHub OAuth Setup

To use GitHub OAuth authentication:

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set the **Homepage URL** to your app's URL (e.g., `http://localhost:3001`)
3. Set the **Authorization callback URL** to `http://localhost:3001/auth/callback` (or your production URL)
4. Copy the **Client ID** and generate a **Client Secret**
5. Set environment variables:
   ```bash
   export GITHUB_CLIENT_ID="your_client_id"
   export GITHUB_CLIENT_SECRET="your_client_secret"
   export OAUTH_CALLBACK_URL="http://localhost:3001/auth/callback"
   ```
6. Start the app and click "Sign in with GitHub" in the UI

Alternatively, you can use a GitHub Personal Access Token directly:
```bash
export COPILOT_GITHUB_TOKEN="gho_your_token_here"
```

The exact models available depend on each provider's account, API access, regional availability, and current catalog. The UI or terminal lists models returned by that provider, but some may not support chat or function/tool calling; those models cannot run browser actions and provider errors are shown in the UI or terminal. Vision screenshots are sent to models identified as image-capable; all models receive the current page's text and interactive-element list.

## Browser behavior and safety

- Each WebSocket connection gets an isolated browser tab and agent run. The page persists through the conversation and sequential tool calls.
- The agent can navigate, inspect, click, fill visible non-password fields, and scroll. It can receive additional user messages during a run; use **Stop** to cancel.
- Form submissions and clicks on consequential controls (for example, purchase, delete, send, or publish) pause for explicit approval. Password inputs are not filled. Only public `http://` and `https://` destinations are accepted; local, private, reserved, and cloud-metadata addresses are blocked.
- Treat this as a personal prototype, not an authenticated multi-user service. Do not expose it publicly without adding user authentication, request/rate limits, and network egress controls. A site can still contain misleading or adversarial instructions; review the page and approval prompt before authorizing consequential actions.
- A model call returns its current response before it can be displayed; browser actions, results, and messages are streamed to the UI as events between model calls.

## Container

The included Dockerfile uses Microsoft's Playwright image, installs Chromium, builds the frontend, and starts the app on port `3001`.

```sh
docker build -t browser-agent .
docker run --rm -p 3001:3001 browser-agent
```

This folder is prepared for container deployment; Docker is not required for local development. No cloud deployment, GitHub Actions workflow, repository, or secret is created by this project. Configure provider keys in the app UI at runtime.

To use a server-side environment key instead of entering it in the UI, pass one or more provider variables when starting the container, for example `docker run --rm -p 3001:3001 -e GROQ_API_KEY=... browser-agent`. Keep real values in a deployment secret manager; never commit them to this folder.

## Tests

```sh
npm test
npm run build
```

The unit tests cover URL validation, action approvals, model-catalog normalization, and vision-model classification. They do not make external provider calls.
