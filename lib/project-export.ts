import { strToU8, zipSync } from "fflate";
import { assertArtifactFilesSafe, assertProjectPayloadSafe } from "./artifact-security.ts";
import { getProductReality, STUDIO_TELEGRAM_CONNECTION_URL } from "./product-reality.ts";
import type { GeneratedProject, ProjectQualityReport } from "@/lib/project-types";

const OFFICIAL_DROPSTAB_MARK = /https:\/\/(?:www\.)?dropstab\.com\/images\/dropstab-logo-drop-default\.svg(?:[?#][^\s"'()<>]*)?/gi;
const LOOPBACK_ORIGIN = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?/gi;
const LOOPBACK_DEPENDENCY = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?/i;
const ROOT_RELATIVE_ARCHIVE_ASSET = /(^|[\s"'(=,:])\/((?:assets|brand)\/[a-z0-9._/-]+(?:[?#][^\s"'()<>,]*)?)/gim;
const UNRESOLVED_ROOT_ARCHIVE_ASSET = /(^|[\s"'(=,:])\/(?:assets|brand)\//im;
const REMOTE_BRAND_ASSET = /https?:\/\/[^\s"'()<>]*\/(?:dropstab-logo-drop-default\.svg|drops-bot-avatar\.(?:jpe?g|png|webp))(?:[?#][^\s"'()<>]*)?/i;
const INLINE_SVG_ELEMENT = /<svg\b/i;
const INLINE_SVG_DATA_URI = /data:image\/svg\+xml/i;

export interface ProjectArchiveAssets {
  brand: {
    dropstabMarkSvg: Uint8Array;
    dropsBotAvatarJpeg: Uint8Array;
  };
  game?: {
    marketCatcherBackgroundPng: Uint8Array;
    marketWolfSpritePng: Uint8Array;
  };
}

function portableEndpoint(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) return `.${value}`;
  return value.replace(LOOPBACK_ORIGIN, ".");
}

function archiveProviderEvidence(quality: ProjectQualityReport): "dropstab" | "fallback" | "unverified" {
  const value = String(quality.runtimeSmoke?.dataProvider || "").trim().toLowerCase();
  if (value === "dropstab" || value === "fallback") return value;
  return "unverified";
}

function stampArchiveProviderEvidence(html: string, evidence: "dropstab" | "fallback" | "unverified"): string {
  return html.replace(/<html\b(?![^>]*\bdata-provider-evidence=)/i, `<html data-provider-evidence="${evidence}"`);
}

function archiveTelegramConnectionUrl(projectSlug: string): string {
  const url = new URL(STUDIO_TELEGRAM_CONNECTION_URL);
  url.searchParams.set("project", projectSlug);
  return url.toString();
}

export function makeArchiveHtmlPortable(
  html: string,
  studioTelegramUrl = STUDIO_TELEGRAM_CONNECTION_URL,
): string {
  const portable = html
    .replace(OFFICIAL_DROPSTAB_MARK, "./brand/dropstab-mark.svg")
    .replace(LOOPBACK_ORIGIN, ".")
    .replace(ROOT_RELATIVE_ARCHIVE_ASSET, "$1./$2")
    .replace(
      /(\b(?:var|let|const)\s+studioTelegramUrl\s*=\s*)(["'])\/\?[^"']*\2/g,
      (_match, declaration: string) => `${declaration}${JSON.stringify(studioTelegramUrl)}`,
    )
    .replace(
      /new URL\(\s*(["'])\/api\/telegram\/verify\1\s*,\s*location\.origin\s*\)/g,
      'new URL("./api/telegram/verify",location.href)',
    )
    .replace(/("dataEndpoint"\s*:\s*")\/(?!\/)/g, "$1./");

  if (UNRESOLVED_ROOT_ARCHIVE_ASSET.test(portable)) {
    throw new Error("ZIP export still contains a root-relative brand or product asset.");
  }
  if (LOOPBACK_DEPENDENCY.test(portable)) {
    throw new Error("ZIP export cannot depend on a localhost or loopback URL.");
  }
  if (/\bblob:/i.test(portable)) {
    throw new Error("ZIP export cannot include a session-only blob URL. Upload or embed the asset before exporting.");
  }
  if (INLINE_SVG_ELEMENT.test(portable) || INLINE_SVG_DATA_URI.test(portable)) {
    throw new Error("ZIP export cannot include handcrafted inline SVG artwork. Use a bundled local asset file.");
  }
  if (REMOTE_BRAND_ASSET.test(portable)) {
    throw new Error("ZIP export cannot depend on a remote DropsTab or Drops Bot brand asset.");
  }
  return portable;
}

function requiredAsset(bytes: Uint8Array | undefined, path: string): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error(`ZIP export is missing required local asset "${path}".`);
  }
  return bytes;
}

function assertLocalReferencesBundled(html: string, files: Record<string, Uint8Array>): void {
  const references = new Set(
    [...html.matchAll(/\.\/((?:assets|brand)\/[a-z0-9._/-]+)/gi)].map((match) => match[1]),
  );
  for (const reference of references) {
    if (!files[reference]?.byteLength) {
      throw new Error(`ZIP export references local asset "${reference}" but did not bundle it.`);
    }
  }
}

function projectReadme(project: GeneratedProject): string {
  const reality = getProductReality(project.spec.presetId);
  const productHuntSetup = project.spec.presetId === "crypto-product-hunt"
    ? `
## Persistent community backend

This Product Hunt export includes real Vercel Functions for listing launches, accepting submissions and deduplicating votes by anonymous browser session. Community state is stored as a private Vercel Blob and is namespaced to this project.

1. Import this folder into Vercel.
2. Create a Vercel Blob store for the project.
3. Connect the Blob store through Vercel OIDC, or add \`BLOB_READ_WRITE_TOKEN\` to the Vercel project environment.
4. Redeploy, then submit and vote from the deployed product.

Credentials are never included in the ZIP, browser HTML, project state or API responses. Without either Vercel's \`BLOB_STORE_ID\` + \`VERCEL_OIDC_TOKEN\` pair or \`BLOB_READ_WRITE_TOKEN\`, every community endpoint returns HTTP 503 with an explicit setup message. The product remains runnable and failed public submissions are saved only as private browser drafts; it never claims they were persisted publicly.

Static-only hosts such as GitHub Pages, Cloudflare Pages and a plain Netlify static deployment can render the product and its private drafts, but they do not run the included Vercel community functions. Use Vercel or replace the documented endpoints with an equivalent durable backend before promising public listings.

The included community service is intentionally honest about its trust boundary: listings are unreviewed, external URLs are unverified, and vote receipts represent browser sessions rather than verified people.
`
    : "";
  return `# ${project.spec.name}

This is a runnable crypto product generated by Drops Studio.

## Reality contract

- Delivery mode: ${reality.deliveryMode}
- Deliverable: ${reality.deliverable}
- Works now: ${reality.worksNow.join("; ")}
- Still requires: ${reality.requires.join("; ")}

Publishing this web app does not claim that an external Telegram channel, wallet feed, trade, community backend or scheduled job exists. Those outcomes are marked pending until their provider verifies them.

For a new Telegram channel, open the [Drops Studio Telegram connection flow](${STUDIO_TELEGRAM_CONNECTION_URL}). It connects the user's Telegram account through the existing MTProto wizard only after explicit consent, creates or selects the real destination, then adds and configures Drops Bot. The Telegram-shaped preview in \`index.html\` is never evidence that this external setup finished.

For a channel the user already owns, a Vercel deployment can use the included session-only BotFather fallback to verify administrator permissions and optionally send a test post. Completion requires Telegram's returned channel identity and, for delivery, a message ID.

## Run locally

Open \`index.html\` directly, or serve this folder with \`npx serve .\`. The exported HTML, official local brand files and category artwork are portable and do not depend on the Drops Studio origin, localhost or browser blob URLs. When no network data is available, the product keeps its saved snapshot and remains interactive.

Run \`node tests/smoke.mjs\` after extraction to verify that every local asset referenced by the product is present. Deploying to Vercel also enables the included session-only Telegram verification function and the server-side public-data adapter. Add \`DROPSTAB_API_KEY\` in the deployment environment to use the export owner's DropsTab budget; without it the adapter returns an honestly labelled public-price fallback.

## Foundation

- DropsTab is the market data, research and context layer.
- Drops Bot is the alert, Telegram and approved action handoff layer; official setup is completed in Telegram.
- Live requests use the public data adapter in \`project.json\`.
- No AI or product API key is bundled in this export.

## Deploy

The browser product works from its saved snapshot on Vercel, Cloudflare Pages, Netlify and GitHub Pages. Vercel additionally runs the bundled DropsTab/public-price data adapter and lets a user verify their own BotFather bot and send a real test post without storing the token.
${productHuntSetup}
`;
}

const telegramFunction = `const attempts = new Map();
function header(req, name) { const value = req.headers && req.headers[name]; return Array.isArray(value) ? String(value[0] || "") : String(value || ""); }
function sameOrigin(req) { if (header(req, "sec-fetch-site").toLowerCase() === "cross-site") return false; const origin = header(req, "origin"); if (!origin) return true; const host = header(req, "x-forwarded-host") || header(req, "host"); const protocol = (header(req, "x-forwarded-proto") || "https").split(",")[0].trim(); try { return new URL(origin).origin === protocol + "://" + host; } catch { return false; } }
function reply(res, status, body) { res.setHeader("cache-control", "no-store"); res.status(status).json(body); }
async function call(token, method, body) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error("Telegram verification failed");
  return payload.result;
}
export default async function handler(req, res) {
  if (!sameOrigin(req)) return reply(res, 403, { error: "Cross-origin Telegram actions are not accepted" });
  if (req.method === "OPTIONS") { res.setHeader("cache-control", "no-store"); return res.status(204).end(); }
  if (req.method !== "POST") return reply(res, 405, { error: "Method not allowed" });
  const key = String(req.headers["x-vercel-forwarded-for"] || req.headers["x-drops-session"] || crypto.randomUUID()).split(",")[0]; const now = Date.now(); const current = attempts.get(key);
  if (!current || current.resetAt < now) attempts.set(key, { count: 1, resetAt: now + 3600000 }); else if (++current.count > 12) return reply(res, 429, { error: "Too many checks" });
  const token = String(req.body?.token || "").trim(); const channel = String(req.body?.channel || "").trim(); const message = String(req.body?.message || "").trim().slice(0, 2000); const sendTest = req.body?.sendTest === true;
  if (!/^\\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return reply(res, 400, { error: "Enter a valid BotFather token" });
  if (!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channel) && !/^-100\\d{6,20}$/.test(channel)) return reply(res, 400, { error: "Enter @channelusername or -100 channel ID" });
  try {
    const bot = await call(token, "getMe"); const chat = await call(token, "getChat", { chat_id: channel }); const member = await call(token, "getChatMember", { chat_id: chat.id, user_id: bot.id });
    if (!["creator", "administrator"].includes(member.status) || member.can_post_messages === false) return reply(res, 409, { error: "Bot needs channel admin post permission" });
    if (sendTest && !message) return reply(res, 400, { error: "Add a test message before sending" });
    const sent = sendTest ? await call(token, "sendMessage", { chat_id: chat.id, text: message, disable_web_page_preview: false }) : null;
    return reply(res, 200, { verified: true, sent: Boolean(sent), bot: { username: bot.username || bot.first_name || "Telegram bot" }, channel: { id: String(chat.id), title: chat.title || chat.username || channel, username: chat.username ? "@" + chat.username : undefined }, messageId: sent?.message_id, storage: "session-only" });
  } catch { return reply(res, 422, { error: "Check the token, channel and bot admin permissions" }); }
}
`;

const publicDataFunction = `const DROPSTAB_API_BASE = "https://public-api.dropstab.com/api/v1";
const FALLBACK_ASSETS = [
  { symbol: "BTC", name: "Bitcoin", product: "BTC-USD" },
  { symbol: "ETH", name: "Ethereum", product: "ETH-USD" },
  { symbol: "SOL", name: "Solana", product: "SOL-USD" },
];
function rowsFrom(body) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const nested = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
  return Array.isArray(body) ? body : Array.isArray(record.data) ? record.data : Array.isArray(nested.content) ? nested.content : Array.isArray(nested.items) ? nested.items : Array.isArray(record.content) ? record.content : Array.isArray(record.items) ? record.items : [];
}
function firstNumber(...values) { for (const value of values) { if (value === null || value === undefined || value === "") continue; const candidate = value && typeof value === "object" && "USD" in value ? value.USD : value; const numeric = Number(candidate); if (Number.isFinite(numeric)) return numeric; } return null; }
function money(value) { if (value === null || !Number.isFinite(value)) return "—"; if (value >= 1_000_000_000) return "$" + (value / 1_000_000_000).toFixed(value >= 100_000_000_000 ? 0 : 2) + "B"; if (value >= 1_000_000) return "$" + (value / 1_000_000).toFixed(2) + "M"; if (value >= 1_000) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 }); return "$" + value.toLocaleString("en-US", { maximumSignificantDigits: 6 }); }
function normalizeCoins(body) { return rowsFrom(body).slice(0, 20).map((raw) => { const symbol = String(raw?.symbol ?? raw?.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); if (!symbol) return null; return { symbol, name: String(raw?.name ?? raw?.title ?? symbol).slice(0, 48), price: money(firstNumber(raw?.price, raw?.currentPrice, raw?.priceUsd)), change: firstNumber(raw?.priceChange24h, raw?.change24h, raw?.percentChange24h, raw?.priceChangePercentage24h), marketCap: money(firstNumber(raw?.marketCap, raw?.marketCapUsd, raw?.cap)) }; }).filter(Boolean); }
async function dropsTabCoins(apiKey) { const url = new URL(DROPSTAB_API_BASE + "/coins"); url.searchParams.set("page", "0"); url.searchParams.set("pageSize", "20"); const response = await fetch(url, { headers: { accept: "application/json", "x-dropstab-api-key": apiKey }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error("DropsTab returned " + response.status); const coins = normalizeCoins(await response.json()); if (!coins.length) throw new Error("DropsTab returned no supported coin rows"); return coins; }
async function fallbackCoins() { return Promise.all(FALLBACK_ASSETS.map(async (asset) => { const response = await fetch("https://api.exchange.coinbase.com/products/" + asset.product + "/stats", { headers: { accept: "application/json", "user-agent": "Drops Studio Export/1.0" }, signal: AbortSignal.timeout(7000) }); if (!response.ok) throw new Error("Fallback feed returned " + response.status); const body = await response.json(); const price = Number(body.last); const open = Number(body.open); return { symbol: asset.symbol, name: asset.name, price: money(price), change: Number.isFinite(price) && Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : null, marketCap: "—" }; })); }
function reply(res, status, body) { res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-methods", "GET, OPTIONS"); res.setHeader("cache-control", status === 200 ? "public, max-age=60, s-maxage=900, stale-while-revalidate=3600" : "no-store"); res.status(status).json(body); }
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return reply(res, 405, { error: "Method not allowed" });
  const fetchedAt = new Date().toISOString();
  const apiKey = String(process.env.DROPSTAB_API_KEY || "").trim();
  if (apiKey) { try { const coins = await dropsTabCoins(apiKey); return reply(res, 200, { coins, unlocks: [], funding: [], activities: [], events: [], source: "DropsTab Public API · export-owned key · 15-minute edge cache", provider: "dropstab", capabilities: { coins: true, unlocks: false, funding: false, activities: false }, fetchedAt }); } catch (_) {} }
  try { const coins = await fallbackCoins(); return reply(res, 200, { coins, unlocks: [], funding: [], activities: [], events: [], source: "Live public price fallback · add DROPSTAB_API_KEY for source-native data", provider: "fallback", capabilities: { coins: false, unlocks: false, funding: false, activities: false }, fetchedAt }); } catch (_) { return reply(res, 502, { error: "Market data is temporarily unavailable" }); }
}
`;

function productHuntStoreFunction(projectSlug: string): string {
  const storagePath = `drops-studio/exports/${projectSlug}/product-hunt-state-v1.json`;
  return String.raw`const STATE_PATH = ${JSON.stringify(storagePath)};
const SESSION_COOKIE = "drops-product-hunt-session";
const CATEGORIES = new Set(["analytics", "ai", "alerts", "community", "data", "games", "media", "research", "trading-tools", "other"]);
const MAX_LAUNCHES = 500;
const MAX_VOTE_RECEIPTS = 50000;

function header(req, name) {
  const headers = req && req.headers || {};
  const value = headers[String(name).toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export function reply(res, status, body) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  return res.status(status).json(body);
}

export function finishOptions(res) {
  res.setHeader("allow", "GET, POST, OPTIONS");
  res.setHeader("cache-control", "no-store");
  return res.status(204).end();
}

export function storageConfigured() {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  const storeId = String(process.env.BLOB_STORE_ID || "").trim();
  const oidcToken = String(process.env.VERCEL_OIDC_TOKEN || "").trim();
  return Boolean(token || (storeId && oidcToken));
}

export function storageUnavailable(res) {
  return reply(res, 503, {
    error: "Community backend is not configured on this deployment. Connect a Vercel Blob store with OIDC, or add BLOB_READ_WRITE_TOKEN in Vercel, then redeploy.",
    providerEvidence: {
      storage: "unavailable",
      persistence: false,
      localFallback: "private browser drafts only",
    },
  });
}

function emptyState() {
  return { version: 1, launches: [], votes: {} };
}

function isLaunch(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.tagline === "string"
    && typeof value.description === "string"
    && typeof value.url === "string"
    && typeof value.urlKey === "string"
    && typeof value.category === "string"
    && typeof value.createdAt === "string"
    && Number.isFinite(Number(value.voteCount));
}

function isState(value) {
  return Boolean(value)
    && typeof value === "object"
    && value.version === 1
    && Array.isArray(value.launches)
    && value.launches.every(isLaunch)
    && Boolean(value.votes)
    && typeof value.votes === "object"
    && Object.values(value.votes).every(function (receipts) {
      return Array.isArray(receipts) && receipts.every(function (receipt) { return typeof receipt === "string"; });
    });
}

async function blobSdk() {
  return import("@vercel/blob");
}

async function readState() {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (!storageConfigured()) throw coded("STORAGE_UNAVAILABLE", "Community storage is not configured.");
  const sdk = await blobSdk();
  const current = await sdk.get(STATE_PATH, {
    access: "private",
    useCache: false,
    ...(token ? { token: token } : {}),
  });
  if (!current) return { state: emptyState(), etag: null };
  if (current.statusCode !== 200 || !current.stream) throw coded("STORAGE_UNAVAILABLE", "Community storage did not return readable state.");
  let parsed;
  try {
    parsed = JSON.parse(await new Response(current.stream).text());
  } catch (_error) {
    throw coded("STORAGE_UNAVAILABLE", "Community storage returned unreadable state.");
  }
  if (!isState(parsed)) throw coded("STORAGE_UNAVAILABLE", "Community storage failed its integrity check.");
  return { state: parsed, etag: current.blob.etag || null };
}

async function writeState(state, etag) {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  const sdk = await blobSdk();
  await sdk.put(STATE_PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
    ...(token ? { token: token } : {}),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function mutateState(mutator) {
  const sdk = await blobSdk();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshot = await readState();
    const next = structuredClone(snapshot.state);
    const result = mutator(next);
    try {
      await writeState(next, snapshot.etag);
      return result;
    } catch (error) {
      const retryable = error instanceof sdk.BlobPreconditionFailedError
        || Number(error && (error.statusCode || error.status)) === 412;
      if (!retryable) throw error;
      if (attempt === 4) throw coded("STORAGE_UNAVAILABLE", "Community storage was busy. Retry the request.");
      await new Promise(function (resolve) {
        setTimeout(resolve, 25 * Math.pow(2, attempt) + Math.random() * 25);
      });
    }
  }
  throw coded("STORAGE_UNAVAILABLE", "Community storage was busy. Retry the request.");
}

function coded(code, message, fields) {
  const error = new Error(message);
  error.code = code;
  if (fields) error.fieldErrors = fields;
  return error;
}

function cleanText(value, label, minimum, maximum) {
  if (typeof value !== "string") throw coded("VALIDATION", label + " is required.", { [label.toLowerCase()]: [label + " is required."] });
  const clean = value.trim().normalize("NFKC");
  if (clean.length < minimum || clean.length > maximum || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    throw coded("VALIDATION", label + " must be plain text between " + minimum + " and " + maximum + " characters.");
  }
  return clean;
}

function privateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) return false;
  const a = parts[0];
  const b = parts[1];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function privateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

function publicUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch (_error) { throw coded("VALIDATION", "Enter a valid public http or https URL.", { url: ["Enter a valid public http or https URL."] }); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw coded("VALIDATION", "Enter a public http or https URL without embedded credentials.", { url: ["Enter a public URL without embedded credentials."] });
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || privateIpv4(hostname) || (hostname.includes(":") && privateIpv6(hostname))) {
    throw coded("VALIDATION", "The launch URL must be publicly reachable.", { url: ["The launch URL must be publicly reachable."] });
  }
  url.hostname = hostname;
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.toString();
}

function parseSubmission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw coded("VALIDATION", "Send a complete launch submission.");
  const category = String(value.category || "").trim();
  if (!CATEGORIES.has(category)) throw coded("VALIDATION", "Choose a supported category.", { category: ["Choose a supported category."] });
  const url = publicUrl(value.url);
  return {
    name: cleanText(value.name, "Name", 2, 60),
    tagline: cleanText(value.tagline, "Tagline", 8, 120),
    description: cleanText(value.description, "Description", 24, 1200),
    url: url,
    urlKey: url.toLowerCase(),
    category: category,
    makerName: value.makerName ? cleanText(value.makerName, "Maker name", 2, 60) : null,
  };
}

function slug(name, id) {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "crypto-product";
  return base + "-" + id.replace(/-/g, "").slice(0, 7);
}

function publicLaunch(launch, viewerHash) {
  return {
    id: launch.id,
    slug: launch.slug,
    name: launch.name,
    tagline: launch.tagline,
    description: launch.description,
    url: launch.url,
    category: launch.category,
    makerName: launch.makerName,
    dropsStudioSlug: null,
    createdAt: launch.createdAt,
    votes: Math.max(0, Number(launch.voteCount) || 0),
    viewerHasVoted: Boolean(viewerHash && (launch.viewerReceipts || []).includes(viewerHash)),
    evidence: {
      listing: "community-submitted",
      destination: "community-url-unverified",
      votes: "browser-session-deduplicated",
      moderation: "unreviewed",
    },
  };
}

function cookie(req, name) {
  const source = header(req, "cookie");
  const part = source.split(";").map(function (value) { return value.trim(); }).find(function (value) { return value.startsWith(name + "="); });
  try { return part ? decodeURIComponent(part.slice(name.length + 1)) : ""; } catch (_error) { return ""; }
}

export async function session(req, res) {
  let id = cookie(req, SESSION_COOKIE);
  const valid = /^[a-f0-9-]{16,64}$/i.test(id);
  if (!valid) {
    id = crypto.randomUUID();
    const secure = header(req, "x-forwarded-proto").split(",")[0].trim() === "https" ? "; Secure" : "";
    res.setHeader("set-cookie", SESSION_COOKIE + "=" + encodeURIComponent(id) + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax" + secure);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("drops-studio-export-hunt-v1:" + id));
  return Array.from(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

export function sameOrigin(req) {
  const fetchSite = header(req, "sec-fetch-site").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  const origin = header(req, "origin");
  if (!origin) return true;
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!host) return false;
  const protocol = (header(req, "x-forwarded-proto") || "https").split(",")[0].trim();
  try { return new URL(origin).origin === new URL(protocol + "://" + host).origin; } catch (_error) { return false; }
}

export async function requestJson(req) {
  const length = Number(header(req, "content-length") || "0");
  if (Number.isFinite(length) && length > 16384) throw coded("TOO_LARGE", "The launch submission is too large.");
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_error) { throw coded("VALIDATION", "Send valid JSON."); }
  }
  throw coded("VALIDATION", "Send the launch as application/json.");
}

export async function listLaunches(sort, limit, viewerHash) {
  const snapshot = await readState();
  const launches = structuredClone(snapshot.state.launches).sort(sort === "new"
    ? function (left, right) { return right.createdAt.localeCompare(left.createdAt); }
    : function (left, right) { return right.voteCount - left.voteCount || right.createdAt.localeCompare(left.createdAt); });
  return {
    launches: launches.slice(0, Math.min(50, Math.max(1, limit))).map(function (launch) {
      launch.viewerReceipts = snapshot.state.votes[launch.id] || [];
      return publicLaunch(launch, viewerHash);
    }),
    total: launches.length,
  };
}

export async function submitLaunch(value, submitterHash) {
  const submission = parseSubmission(value);
  const id = crypto.randomUUID();
  const launch = {
    id: id,
    slug: slug(submission.name, id),
    name: submission.name,
    tagline: submission.tagline,
    description: submission.description,
    url: submission.url,
    urlKey: submission.urlKey,
    category: submission.category,
    makerName: submission.makerName,
    submitterHash: submitterHash,
    createdAt: new Date().toISOString(),
    voteCount: 0,
  };
  return mutateState(function (state) {
    if (state.launches.some(function (item) { return item.urlKey === launch.urlKey; })) throw coded("DUPLICATE", "This public URL already has a community launch.");
    if (state.launches.length >= MAX_LAUNCHES) throw coded("CAPACITY", "This community board reached its safe capacity.");
    state.launches.push(launch);
    return publicLaunch(launch, submitterHash);
  });
}

export async function voteLaunch(id, voterHash) {
  return mutateState(function (state) {
    const launch = state.launches.find(function (item) { return item.id === id; });
    if (!launch) throw coded("NOT_FOUND", "Community launch not found.");
    const receipts = state.votes[id] || (state.votes[id] = []);
    if (receipts.includes(voterHash)) return { accepted: false, votes: launch.voteCount };
    const receiptCount = Object.values(state.votes).reduce(function (sum, list) { return sum + list.length; }, 0);
    if (receiptCount >= MAX_VOTE_RECEIPTS) throw coded("CAPACITY", "This community board reached its safe vote capacity.");
    receipts.push(voterHash);
    launch.voteCount += 1;
    return { accepted: true, votes: launch.voteCount };
  });
}

export function errorResponse(res, error) {
  const code = error && error.code || "INTERNAL";
  const status = code === "VALIDATION" ? 400 : code === "TOO_LARGE" ? 413 : code === "DUPLICATE" ? 409 : code === "NOT_FOUND" ? 404 : code === "CAPACITY" ? 507 : code === "STORAGE_UNAVAILABLE" ? 503 : 500;
  return reply(res, status, {
    error: error && error.message || "The community service could not complete this request.",
    ...(error && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    ...(code === "CAPACITY" ? { providerEvidence: { storage: "vercel-blob", persistence: true, capacity: "reached" } } : {}),
    ...(code === "STORAGE_UNAVAILABLE" ? { providerEvidence: { storage: "unavailable", persistence: false, localFallback: "private browser drafts only" } } : {}),
    ...(code === "INTERNAL" ? { providerEvidence: { storage: "unknown", persistence: "unknown", failure: "internal" } } : {}),
  });
}

export function providerEvidence() {
  return { storage: "vercel-blob", listings: "community-submitted", moderation: "unreviewed" };
}

export function actorEvidence() {
  return { authenticated: false, scope: "browser-session", claim: "A browser-session receipt is not proof of a unique person or verified identity." };
}
`;
}

const productHuntLaunchesFunction = String.raw`import {
  actorEvidence,
  errorResponse,
  finishOptions,
  listLaunches,
  providerEvidence,
  reply,
  requestJson,
  sameOrigin,
  session,
  storageConfigured,
  storageUnavailable,
  submitLaunch,
} from "../../server/product-hunt-store.mjs";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return finishOptions(res);
  if (req.method !== "GET" && req.method !== "POST") return reply(res, 405, { error: "Method not allowed" });
  if (!storageConfigured()) return storageUnavailable(res);
  try {
    const viewerHash = await session(req, res);
    if (req.method === "GET") {
      const url = new URL(req.url || "/api/product-hunt/launches", "https://export.local");
      const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
      const rawLimit = url.searchParams.get("limit") || "24";
      if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) return reply(res, 400, { error: "Limit must be an integer from 1 to 50." });
      const result = await listLaunches(sort, Number(rawLimit), viewerHash);
      return reply(res, 200, { launches: result.launches, total: result.total, sort: sort, actor: actorEvidence(), providerEvidence: providerEvidence() });
    }
    if (!sameOrigin(req)) return reply(res, 403, { error: "Cross-site community submissions are not accepted." });
    if (!String(req.headers && req.headers["content-type"] || "").toLowerCase().includes("application/json")) return reply(res, 415, { error: "Send the launch as application/json." });
    const launch = await submitLaunch(await requestJson(req), viewerHash);
    return reply(res, 201, { launch: launch, actor: actorEvidence(), providerEvidence: { ...providerEvidence(), destination: "community-url-unverified" } });
  } catch (error) {
    return errorResponse(res, error);
  }
}
`;

const productHuntVoteFunction = String.raw`import {
  actorEvidence,
  errorResponse,
  finishOptions,
  providerEvidence,
  reply,
  sameOrigin,
  session,
  storageConfigured,
  storageUnavailable,
  voteLaunch,
} from "../../../../server/product-hunt-store.mjs";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return finishOptions(res);
  if (req.method !== "POST") return reply(res, 405, { error: "Method not allowed" });
  if (!storageConfigured()) return storageUnavailable(res);
  if (!sameOrigin(req)) return reply(res, 403, { error: "Cross-site votes are not accepted." });
  const path = new URL(req.url || "/", "https://export.local").pathname;
  const match = path.match(/\/launches\/([^/]+)\/vote\/?$/);
  const id = String(req.query && req.query.id || match && decodeURIComponent(match[1]) || "");
  if (!/^[a-f0-9-]{36}$/i.test(id)) return reply(res, 400, { error: "Invalid community launch id." });
  try {
    const voterHash = await session(req, res);
    const result = await voteLaunch(id, voterHash);
    return reply(res, result.accepted ? 201 : 200, {
      accepted: result.accepted,
      duplicate: !result.accepted,
      votes: result.votes,
      viewerHasVoted: true,
      actor: actorEvidence(),
      providerEvidence: { ...providerEvidence(), vote: result.accepted ? "browser-session-receipt-created" : "existing-browser-session-receipt" },
    });
  } catch (error) {
    return errorResponse(res, error);
  }
}
`;

export function buildProjectArchiveFiles(
  project: GeneratedProject,
  quality: ProjectQualityReport,
  assets: ProjectArchiveAssets,
): Record<string, Uint8Array> {
  assertProjectPayloadSafe(project.spec, "exported project spec");
  const slug = project.spec.slug;
  const reality = getProductReality(project.spec.presetId);
  const providerEvidence = archiveProviderEvidence(quality);
  const archiveHtml = makeArchiveHtmlPortable(
    stampArchiveProviderEvidence(project.html, providerEvidence),
    archiveTelegramConnectionUrl(project.spec.slug),
  );
  const portableSpec = {
    ...project.spec,
    dataEndpoint: portableEndpoint(project.spec.dataEndpoint),
  };
  const portableProjectJson = makeArchiveHtmlPortable(
    JSON.stringify(portableSpec, null, 2),
  );
  const integrationManifest = {
    schemaVersion: 1,
    data: {
      contract: "DropsTab-compatible adapter",
      providerEvidence,
      endpoint: portableSpec.dataEndpoint,
      polling: false,
      sharedCacheSeconds: 900,
    },
    actions: { provider: "Drops Bot", mode: "guided official handoff", automaticExecution: false },
    telegram: {
      newChannel: {
        mode: "studio-mtproto-handoff",
        url: STUDIO_TELEGRAM_CONNECTION_URL,
        userConsentRequired: true,
        credentialsIncluded: false,
        completionEvidence: ["Telegram channel identity", "Configured bot administrator", "Test-message ID"],
      },
      existingChannel: {
        mode: "session-only-bot-verification",
        endpoint: "./api/telegram/verify",
        credentialsIncluded: false,
        completionEvidence: ["Telegram channel identity", "Bot administrator status", "Optional test-message ID"],
      },
    },
    ai: { provider: project.spec.brain.provider, model: project.spec.brain.model, keyIncluded: false },
    ...(project.spec.presetId === "crypto-product-hunt" ? {
      community: {
        enabled: true,
        provider: "Vercel Blob",
        storagePath: `drops-studio/exports/${slug}/product-hunt-state-v1.json`,
        endpoints: {
          launches: "./api/product-hunt/launches",
          vote: "./api/product-hunt/launches/:id/vote",
        },
        credentialsIncluded: false,
        unconfiguredStatus: 503,
        fallback: "private browser drafts only",
      },
    } : {}),
    reality,
  };
  const files: Record<string, Uint8Array> = {
    "index.html": strToU8(archiveHtml),
    "README.md": strToU8(projectReadme(project)),
    "project.json": strToU8(portableProjectJson),
    "quality-report.json": strToU8(JSON.stringify(quality, null, 2)),
    "drops.config.json": strToU8(JSON.stringify(integrationManifest, null, 2)),
    "tests/smoke.mjs": strToU8(`import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nconst html = await readFile(new URL("../index.html", import.meta.url), "utf8");\nassert.match(html, /data-project-kind="${project.spec.presetId}"/);\nassert.match(html, /data-provider-evidence="(?:dropstab|fallback|unverified)"/);\nassert.match(html, /DropsTab/);\nassert.match(html, /Drops Bot/);\nassert.doesNotMatch(html, /(?:^|[\\s"'(=,:])\\\/(?:assets|brand)\\\//im);\nassert.doesNotMatch(html, /https?:\\/\\/[^\\s"'()<>]*\\/(?:dropstab-logo-drop-default\\.svg|drops-bot-avatar\\.(?:jpe?g|png|webp))/i);\nassert.doesNotMatch(html, /https?:\\/\\/(?:localhost|127(?:\\.\\d{1,3}){3}|0\\.0\\.0\\.0|\\[::1\\])(?::\\d+)?/i);\nassert.doesNotMatch(html, /\\bblob:/i);\nassert.doesNotMatch(html, /<svg\\b/i);\nassert.doesNotMatch(html, /data:image\\/svg\\+xml/i);\nassert.doesNotMatch(html, /font-size:\\s*(?:[6-9]|10|11)px/i);\nassert.doesNotMatch(html, /\\beval\\s*\\(|new Function/);\nconst assetReferences = new Set([...html.matchAll(/\\.\\/((?:assets|brand)\\/[a-z0-9._/-]+)/gi)].map((match) => match[1]));\nfor (const asset of assetReferences) await readFile(new URL("../" + asset, import.meta.url));\nawait readFile(new URL("../brand/dropstab-mark.svg", import.meta.url));\nawait readFile(new URL("../brand/drops-bot-avatar.jpg", import.meta.url));\nawait readFile(new URL("../api/public-data.mjs", import.meta.url));\nif (/data-project-kind="crypto-game"/.test(html)) {\n  await readFile(new URL("../assets/market-catcher-retro.png", import.meta.url));\n}\nif (/data-project-kind="(?:crypto-game|portfolio-tamagotchi)"/.test(html)) {\n  await readFile(new URL("../assets/market-wolf-catcher.png", import.meta.url));\n}\nif (/data-project-kind="(?:alpha-channel|morning-alpha)"/.test(html)) {\n  assert.match(html, /flow=telegram-channel/);\n  assert.match(html, /existing channel/i);\n  assert.match(html, /PREVIEW · NOT PUBLISHED/);\n}\nconsole.log("Drops Studio smoke checks passed");\n`),
    "api/telegram/verify.mjs": strToU8(telegramFunction),
    "api/public-data.mjs": strToU8(publicDataFunction),
    "vercel.json": strToU8(JSON.stringify({
      cleanUrls: true,
      trailingSlash: false,
      headers: [{
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      }],
    }, null, 2)),
    "netlify.toml": strToU8(`[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    X-Frame-Options = "SAMEORIGIN"\n    Content-Security-Policy = "frame-ancestors 'self'"\n`),
    "wrangler.toml": strToU8(`name = "${slug}"\ncompatibility_date = "2026-07-28"\n[assets]\ndirectory = "."\n`),
    ".github/workflows/pages.yml": strToU8(`name: Deploy static site to Pages\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\njobs:\n  deploy:\n    environment:\n      name: github-pages\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: .\n      - uses: actions/deploy-pages@v4\n`),
    "brand/dropstab-mark.svg": requiredAsset(
      assets.brand?.dropstabMarkSvg,
      "brand/dropstab-mark.svg",
    ),
    "brand/drops-bot-avatar.jpg": requiredAsset(
      assets.brand?.dropsBotAvatarJpeg,
      "brand/drops-bot-avatar.jpg",
    ),
  };
  if (archiveHtml.includes("./assets/market-catcher-retro.png")) {
    files["assets/market-catcher-retro.png"] = requiredAsset(
      assets.game?.marketCatcherBackgroundPng,
      "assets/market-catcher-retro.png",
    );
  }
  if (archiveHtml.includes("./assets/market-wolf-catcher.png")) {
    files["assets/market-wolf-catcher.png"] = requiredAsset(
      assets.game?.marketWolfSpritePng,
      "assets/market-wolf-catcher.png",
    );
  }
  if (project.spec.presetId === "crypto-product-hunt") {
    files["package.json"] = strToU8(JSON.stringify({
      private: true,
      type: "module",
      engines: { node: ">=20" },
      scripts: { test: "node tests/smoke.mjs && node tests/community-smoke.mjs" },
      dependencies: { "@vercel/blob": "2.6.1" },
    }, null, 2));
    files[".env.example"] = strToU8([
      "# Required for persistent public listings and browser-session vote receipts on Vercel.",
      "# Create a Vercel Blob store, add this variable in project settings, and redeploy.",
      "# Never commit or expose the real token in index.html or project.json.",
      "BLOB_READ_WRITE_TOKEN=",
      "",
      "# Optional owner-supplied DropsTab API budget for source-native market data.",
      "DROPSTAB_API_KEY=",
      "",
    ].join("\n"));
    files["server/product-hunt-store.mjs"] = strToU8(productHuntStoreFunction(slug));
    files["api/product-hunt/launches.mjs"] = strToU8(productHuntLaunchesFunction);
    files["api/product-hunt/launches/[id]/vote.mjs"] = strToU8(productHuntVoteFunction);
    files["tests/community-smoke.mjs"] = strToU8(`import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nfor (const file of ["../api/product-hunt/launches.mjs", "../api/product-hunt/launches/[id]/vote.mjs", "../server/product-hunt-store.mjs"]) await readFile(new URL(file, import.meta.url));\nconst envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");\nassert.match(envExample, /^BLOB_READ_WRITE_TOKEN=$/m);\nconst manifest = JSON.parse(await readFile(new URL("../drops.config.json", import.meta.url), "utf8"));\nassert.equal(manifest.community.provider, "Vercel Blob");\nassert.equal(manifest.community.credentialsIncluded, false);\nconsole.log("Drops Studio community backend smoke checks passed");\n`);
  }
  assertLocalReferencesBundled(archiveHtml, files);
  assertArtifactFilesSafe(files);
  return files;
}

export function createProjectArchive(
  project: GeneratedProject,
  quality: ProjectQualityReport,
  assets: ProjectArchiveAssets,
): Uint8Array {
  return zipSync(
    buildProjectArchiveFiles(project, quality, assets),
    { level: 6 },
  );
}
