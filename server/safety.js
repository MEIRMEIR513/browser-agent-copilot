import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const hostSafetyCache = new Map();

export function normalizeHttpUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete URL beginning with http:// or https://.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// pages can be opened.");
  }
  return url.href;
}

function isNonPublicIp(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith("::") ||
      /^[fcfd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2002:") ||
      normalized.startsWith("64:ff9b:") ||
      !/^[23]/.test(normalized);
  }
  return true;
}

export async function assertPublicHttpUrl(input) {
  const url = new URL(normalizeHttpUrl(input));
  if (url.username || url.password) throw new Error("URLs containing embedded credentials are blocked.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname === "metadata" ||
      hostname === "metadata.google.internal") {
    throw new Error("Local and cloud metadata hosts are blocked.");
  }
  const directIpVersion = isIP(hostname);
  if (directIpVersion) {
    if (isNonPublicIp(hostname)) throw new Error("Private and reserved IP addresses are blocked.");
    return url.href;
  }
  const cached = hostSafetyCache.get(hostname);
  if (!cached || cached.expiresAt < Date.now()) {
    hostSafetyCache.set(hostname, {
      expiresAt: Date.now() + 30_000,
      promise: lookup(hostname, { all: true, verbatim: true })
        .then((addresses) => addresses.length > 0 && addresses.every(({ address }) => !isNonPublicIp(address)))
        .catch(() => false)
    });
  }
  if (!(await hostSafetyCache.get(hostname).promise)) {
    throw new Error("This host cannot be safely resolved to public IP addresses.");
  }
  return url.href;
}

const consequentialText =
  /\b(pay|purchase|buy now|checkout|place order|delete|remove permanently|send|publish|post|submit|confirm|transfer|unsubscribe|cancel subscription)\b/i;

export function needsApproval({ label = "", isSubmit = false } = {}) {
  return isSubmit || consequentialText.test(label);
}

export function parseModelList(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : payload?.data ?? payload?.models ?? payload?.items ?? [];
  return candidates
    .map((item) => {
      const id = typeof item === "string" ? item : item?.id ?? item?.name ?? item?.model;
      if (!id || typeof id !== "string") return null;
      const cleanId = id.replace(/^models\//, "");
      const name = typeof item?.displayName === "string"
        ? item.displayName
        : typeof item?.name === "string" ? item.name.replace(/^models\//, "") : cleanId;
      return {
        id: cleanId,
        name,
        vision: Boolean(item?.vision || item?.capabilities?.vision ||
          item?.input?.includes?.("image") || item?.modalities?.includes?.("image") ||
          item?.inputModalities?.includes?.("image"))
      };
    })
    .filter(Boolean);
}

export function modelSupportsVision(provider, model) {
  if (provider === "gemini") return /gemini/i.test(model);
  return /vision|llava|gpt-4o|gpt-4\.1|gpt-4-turbo|pixtral|llama-4/i.test(model);
}
