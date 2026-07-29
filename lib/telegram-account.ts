import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const TOKEN_VERSION = 1;
const FLOW_TTL_MS = 15 * 60 * 1_000;
const ACCOUNT_TTL_MS = 8 * 60 * 60 * 1_000;
const TELEGRAM_AUTH_DEADLINE_MS = 25_000;

type TelegramFlowToken = {
  kind: "login-flow";
  version: number;
  createdAt: number;
  phoneNumber: string;
  phoneCodeHash: string;
  session: string;
};

type TelegramAccountToken = {
  kind: "account";
  version: number;
  createdAt: number;
  session: string;
  userId: string;
  displayName: string;
  username?: string;
};

export type TelegramAccountSummary = {
  id: string;
  displayName: string;
  username?: string;
};

export type TelegramChannelResult = {
  id: string;
  title: string;
  username?: string;
  url: string;
  botUsername: string;
  botAdded: boolean;
  firstPostSent: boolean;
  dmSent: boolean;
  dmStartUrl: string;
  warnings: string[];
  accountToken: string;
};

type StoredTelegramChannelResult = Omit<TelegramChannelResult, "accountToken">;

type TelegramChannelRequestRecord = {
  status: "pending" | "completed";
  createdAt: number;
  expiresAt: number;
  result?: StoredTelegramChannelResult;
};

type TelegramChannelRequestClaim = {
  pathname: string;
  persistent: boolean;
  existing?: StoredTelegramChannelResult;
};

function blobIsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN);
}

async function readTelegramChannelRequest(pathname: string): Promise<{ record: TelegramChannelRequestRecord; etag: string } | null> {
  const { del, get } = await import("@vercel/blob");
  const current = await get(pathname, { access: "private", useCache: false });
  if (!current || current.statusCode !== 200) return null;
  let record: TelegramChannelRequestRecord;
  try {
    record = JSON.parse(await new Response(current.stream).text()) as TelegramChannelRequestRecord;
  } catch {
    await del(pathname).catch(() => undefined);
    return null;
  }
  if (!record || !["pending", "completed"].includes(record.status) || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt)) return null;
  if (record.expiresAt <= Date.now()) {
    await del(pathname).catch(() => undefined);
    return null;
  }
  if (record.status === "completed") {
    const result = record.result;
    if (!result || !result.id || !/^https:\/\/t\.me\//i.test(result.url) || !/^@[A-Za-z0-9_]{3,}$/.test(result.botUsername)) {
      await del(pathname).catch(() => undefined);
      return null;
    }
  }
  return { record, etag: current.blob.etag };
}

async function claimTelegramChannelRequest(accountId: string, requestId: string): Promise<TelegramChannelRequestClaim> {
  if (!blobIsConfigured()) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Secure Telegram channel creation is temporarily unavailable.");
    return { pathname: "", persistent: false };
  }
  const { put } = await import("@vercel/blob");
  const key = createHash("sha256").update(`${accountId}:${requestId}`).digest("hex").slice(0, 40);
  const pathname = `drops-studio/telegram-channel-requests/${key}.json`;
  const current = await readTelegramChannelRequest(pathname);
  if (current?.record.status === "completed" && current.record.result) return { pathname, persistent: true, existing: current.record.result };
  if (current?.record.status === "pending" && Date.now() - current.record.createdAt < 2 * 60 * 1_000) {
    throw new Error("This channel creation is already in progress. Wait a moment before retrying.");
  }
  try {
    const createdAt = Date.now();
    await put(pathname, JSON.stringify({ status: "pending", createdAt, expiresAt: createdAt + ACCOUNT_TTL_MS } satisfies TelegramChannelRequestRecord), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: Boolean(current),
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
      ...(current ? { ifMatch: current.etag } : {}),
    });
  } catch {
    const raced = await readTelegramChannelRequest(pathname);
    if (raced?.record.status === "completed" && raced.record.result) return { pathname, persistent: true, existing: raced.record.result };
    if (raced?.record.status === "pending") throw new Error("This channel creation is already in progress. Wait a moment before retrying.");
    throw new Error("Secure Telegram channel creation is temporarily unavailable.");
  }
  return { pathname, persistent: true };
}

async function completeTelegramChannelRequest(claim: TelegramChannelRequestClaim, result: TelegramChannelResult): Promise<void> {
  if (!claim.persistent) return;
  const { put } = await import("@vercel/blob");
  const storedResult: StoredTelegramChannelResult = {
    id: result.id,
    title: result.title,
    username: result.username,
    url: result.url,
    botUsername: result.botUsername,
    botAdded: result.botAdded,
    firstPostSent: result.firstPostSent,
    dmSent: result.dmSent,
    dmStartUrl: result.dmStartUrl,
    warnings: result.warnings,
  };
  const createdAt = Date.now();
  await put(claim.pathname, JSON.stringify({ status: "completed", createdAt, expiresAt: createdAt + ACCOUNT_TTL_MS, result: storedResult } satisfies TelegramChannelRequestRecord), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}

async function releaseTelegramChannelRequest(claim: TelegramChannelRequestClaim): Promise<void> {
  if (!claim.persistent) return;
  const { del } = await import("@vercel/blob");
  await del(claim.pathname);
}

function telegramCredentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
  if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw new Error("Telegram account connection is not configured on this deployment.");
  }
  return { apiId, apiHash };
}

function encryptionKey(): Buffer {
  const configured = process.env.TELEGRAM_SESSION_ENCRYPTION_KEY?.trim();
  const developmentFallback = process.env.NODE_ENV === "production" ? "" : process.env.TELEGRAM_API_HASH?.trim();
  const material = configured || developmentFallback || "";
  if (material.length < 24) throw new Error("Telegram session encryption is not configured.");
  return createHash("sha256").update(material).digest();
}

function seal(payload: TelegramFlowToken | TelegramAccountToken): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function unseal<T extends TelegramFlowToken | TelegramAccountToken>(token: string): T {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("The Telegram connection expired. Connect again.");
  try {
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as T;
    if (payload.version !== TOKEN_VERSION || !payload.createdAt || !payload.session) throw new Error("Invalid token");
    return payload;
  } catch {
    throw new Error("The Telegram connection expired. Connect again.");
  }
}

function accountName(user: unknown): TelegramAccountSummary {
  const input = user && typeof user === "object" ? user as Record<string, unknown> : {};
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName = typeof input.lastName === "string" ? input.lastName.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const id = String(input.id ?? "");
  return {
    id,
    displayName: [firstName, lastName].filter(Boolean).join(" ") || username || "Telegram account",
    ...(username ? { username: `@${username}` } : {}),
  };
}

function telegramError(error: unknown): string {
  const input = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = String(input.errorMessage || input.message || "").toUpperCase();
  if (message.includes("PHONE_NUMBER_INVALID")) return "Enter a valid Telegram phone number with country code.";
  if (message.includes("PHONE_CODE_INVALID")) return "That Telegram code is incorrect.";
  if (message.includes("PHONE_CODE_EXPIRED")) return "That Telegram code expired. Request a new one.";
  if (message.includes("PASSWORD_HASH_INVALID")) return "The Telegram two-step password is incorrect.";
  if (message.includes("FLOOD_WAIT")) return "Telegram temporarily rate-limited sign-in. Try again later.";
  if (message.includes("CHANNELS_TOO_MUCH")) return "This Telegram account has reached its channel limit.";
  if (message.includes("USER_RESTRICTED")) return "Telegram does not currently allow this account to create channels.";
  if (message.includes("USERNAME")) return "That public channel username is unavailable. Leave it blank or choose another.";
  if (message.includes("DID NOT RESPOND") || message.includes("TIMEOUT") || message.includes("TIMED OUT")) return "Telegram did not respond in time. Try again.";
  return "Telegram could not complete this step. Check the details and try again.";
}

async function clientFromSession(session = "") {
  const credentials = telegramCredentials();
  const client = new TelegramClient(new StringSession(session), credentials.apiId, credentials.apiHash, {
    connectionRetries: 2,
    requestRetries: 2,
    timeout: 10,
    autoReconnect: false,
  });
  await client.connect();
  return { client, credentials };
}

async function closeClient(client: TelegramClient) {
  try {
    await client.disconnect();
  } catch {
    // The serverless request is ending; no further action is required.
  }
}

async function withTelegramClient<T>(
  session: string,
  operation: (client: TelegramClient, credentials: ReturnType<typeof telegramCredentials>) => Promise<T>,
): Promise<T> {
  const credentials = telegramCredentials();
  const client = new TelegramClient(new StringSession(session), credentials.apiId, credentials.apiHash, {
    connectionRetries: 2,
    requestRetries: 2,
    timeout: 10,
    autoReconnect: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.connect();
        return operation(client, credentials);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Telegram did not respond in time. Try again.")), TELEGRAM_AUTH_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await closeClient(client);
  }
}

export async function sendTelegramLoginCode(phoneNumber: string) {
  const normalized = phoneNumber.replace(/[\s()-]/g, "");
  if (!/^\+\d{7,15}$/.test(normalized)) throw new Error("Enter a valid phone number with country code, for example +44…");
  try {
    return await withTelegramClient("", async (client, credentials) => {
      const result = await client.sendCode(credentials, normalized);
      if (result.emailRequired || result.emailCodeSent) {
        throw new Error("This Telegram account requires email verification, which is not supported in the current connection flow yet.");
      }
      const flow: TelegramFlowToken = {
        kind: "login-flow",
        version: TOKEN_VERSION,
        createdAt: Date.now(),
        phoneNumber: normalized,
        phoneCodeHash: result.phoneCodeHash,
        session: client.session.save() as unknown as string,
      };
      return { flowToken: seal(flow), delivery: result.isCodeViaApp ? "telegram" : "sms" };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("email verification")) throw error;
    throw new Error(telegramError(error));
  }
}

export async function signInTelegramAccount(flowToken: string, phoneCode: string, password?: string) {
  const flow = unseal<TelegramFlowToken>(flowToken);
  if (flow.kind !== "login-flow" || Date.now() - flow.createdAt > FLOW_TTL_MS) throw new Error("The Telegram code expired. Request a new one.");
  if (!/^\d{3,8}$/.test(phoneCode)) throw new Error("Enter the numeric code Telegram sent you.");
  try {
    return await withTelegramClient(flow.session, async (client, credentials) => {
      let user: unknown;
      try {
        const authorization = await client.invoke(new Api.auth.SignIn({
          phoneNumber: flow.phoneNumber,
          phoneCodeHash: flow.phoneCodeHash,
          phoneCode,
        }));
        if (authorization instanceof Api.auth.AuthorizationSignUpRequired) {
          throw new Error("Use an existing Telegram account; account registration is not supported here.");
        }
        user = authorization.user;
      } catch (error) {
        const input = error && typeof error === "object" ? error as Record<string, unknown> : {};
        const message = String(input.errorMessage || input.message || "").toUpperCase();
        if (!message.includes("SESSION_PASSWORD_NEEDED")) throw error;
        if (!password) {
          const nextFlow: TelegramFlowToken = { ...flow, createdAt: Date.now(), session: client.session.save() as unknown as string };
          return { requiresPassword: true as const, flowToken: seal(nextFlow) };
        }
        user = await client.signInWithPassword(credentials, {
          password: async () => password,
          onError: async () => true,
        });
      }
      const account = accountName(user);
      if (!account.id) throw new Error("Telegram did not return an account identity.");
      const token: TelegramAccountToken = {
        kind: "account",
        version: TOKEN_VERSION,
        createdAt: Date.now(),
        session: client.session.save() as unknown as string,
        userId: account.id,
        displayName: account.displayName,
        username: account.username,
      };
      return { requiresPassword: false as const, account, accountToken: seal(token) };
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("existing Telegram") || error.message.includes("identity"))) throw error;
    throw new Error(telegramError(error));
  }
}

async function botCall<T>(token: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: T } | null;
  if (!response.ok || !body?.ok || body.result === undefined) throw new Error("Bot API request failed");
  return body.result;
}

export async function createTelegramChannel(input: {
  accountToken: string;
  requestId: string;
  title: string;
  about: string;
  username?: string;
  firstPost: string;
  botToken?: string;
}): Promise<TelegramChannelResult> {
  const account = unseal<TelegramAccountToken>(input.accountToken);
  if (account.kind !== "account" || Date.now() - account.createdAt > ACCOUNT_TTL_MS) throw new Error("The Telegram account session expired. Connect again.");
  if (!/^[a-f0-9-]{16,64}$/i.test(input.requestId)) throw new Error("Start a fresh channel creation request.");
  const title = input.title.trim().slice(0, 64);
  const about = input.about.trim().slice(0, 255);
  const username = input.username?.trim().replace(/^@/, "").slice(0, 32) || "";
  const firstPost = input.firstPost.trim().slice(0, 3_500);
  if (title.length < 2) throw new Error("Give the channel a name.");
  if (username && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) throw new Error("A public username needs 5–32 letters, numbers or underscores.");
  if (!firstPost) throw new Error("Add the first channel post.");
  const botToken = input.botToken?.trim() || process.env.DROPS_STUDIO_TELEGRAM_BOT_TOKEN?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || process.env.COLDMATH_TELEGRAM_BOT_TOKEN?.trim() || "";
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw new Error("Drops Studio bot is not configured on this deployment.");

  const claim = await claimTelegramChannelRequest(account.userId, input.requestId);
  if (claim.existing) {
    const refreshedAccount: TelegramAccountToken = { ...account, createdAt: Date.now() };
    return { ...claim.existing, accountToken: seal(refreshedAccount) };
  }

  let client: TelegramClient | null = null;
  let channel: Api.Channel | null = null;
  let channelId = "";
  try {
    ({ client } = await clientFromSession(account.session));
    const me = await client.getMe();
    const currentAccount = accountName(me);
    if (currentAccount.id !== account.userId) throw new Error("The Telegram account changed. Connect again.");

    // Resolve the bot before creating anything. A bad token or inaccessible bot
    // must fail without leaving an orphan Telegram channel behind.
    const bot = await botCall<{ id: number; username?: string; first_name?: string }>(botToken, "getMe");
    if (!bot.username) throw new Error("The configured Telegram bot has no public username.");
    const botEntity = await client.getEntity(bot.username);

    const created = await client.invoke(new Api.channels.CreateChannel({ broadcast: true, megagroup: false, title, about }));
    const chats = "chats" in created && Array.isArray(created.chats) ? created.chats : [];
    channel = chats.find((chat) => chat instanceof Api.Channel) ?? null;
    if (!channel) throw new Error("Telegram created the channel but did not return its identity.");
    channelId = await client.getPeerId(channel);

    const warnings: string[] = [];
    let publicUsername = "";
    if (username) {
      try {
        const available = await client.invoke(new Api.channels.CheckUsername({ channel, username }));
        if (!available) throw new Error("Username unavailable");
        await client.invoke(new Api.channels.UpdateUsername({ channel, username }));
        publicUsername = username;
      } catch {
        warnings.push(`@${username} was unavailable, so Telegram kept the new channel private with a shareable invite.`);
      }
    }

    await client.invoke(new Api.channels.EditAdmin({
      channel,
      userId: botEntity,
      adminRights: new Api.ChatAdminRights({
        changeInfo: false,
        postMessages: true,
        editMessages: true,
        deleteMessages: false,
        inviteUsers: false,
        pinMessages: false,
        postStories: false,
        editStories: false,
        deleteStories: false,
      }),
      rank: "Drops Studio",
    }));

    await botCall(botToken, "sendMessage", {
      chat_id: channelId,
      text: firstPost,
      disable_web_page_preview: false,
    });

    let inviteUrl = publicUsername ? `https://t.me/${publicUsername}` : "";
    if (!inviteUrl) {
      const invite = await client.invoke(new Api.messages.ExportChatInvite({ peer: channel, title: "Drops Studio launch link" }));
      if (invite instanceof Api.ChatInviteExported) inviteUrl = invite.link;
    }
    if (!inviteUrl) throw new Error("Telegram did not return a share link for the new channel.");

    const dmStartUrl = `https://t.me/${bot.username}?start=drops_studio`;
    const refreshedToken: TelegramAccountToken = { ...account, createdAt: Date.now(), session: client.session.save() as unknown as string };
    const result: TelegramChannelResult = {
      id: channelId,
      title,
      ...(publicUsername ? { username: `@${publicUsername}` } : {}),
      url: inviteUrl,
      botUsername: `@${bot.username}`,
      botAdded: true,
      firstPostSent: true,
      dmSent: false,
      dmStartUrl,
      warnings,
      accountToken: seal(refreshedToken),
    };
    await completeTelegramChannelRequest(claim, result);
    try {
      await botCall(botToken, "sendMessage", {
        chat_id: account.userId,
        text: `Your Drops Studio channel is live: ${inviteUrl}\n\nBot: @${bot.username}\nFirst post: published`,
        disable_web_page_preview: false,
      });
      result.dmSent = true;
      await completeTelegramChannelRequest(claim, result).catch(() => undefined);
    } catch {
      // Telegram bots can message a user only after the user has started the bot.
    }
    return result;
  } catch (error) {
    let cleanupFailed = false;
    if (client && channel) {
      try {
        await client.invoke(new Api.channels.DeleteChannel({ channel }));
      } catch {
        cleanupFailed = true;
      }
    }
    if (!cleanupFailed) await releaseTelegramChannelRequest(claim).catch(() => undefined);
    const rawMessage = error instanceof Error ? error.message : "";
    const known = ["Give the channel", "public username", "first channel", "not configured", "account changed", "did not return", "no public username", "unavailable", "share link", "already in progress", "temporarily unavailable"];
    const message = known.some((text) => rawMessage.includes(text)) ? rawMessage : telegramError(error);
    if (cleanupFailed) throw new Error(`${message} Telegram channel ${channelId || `"${title}"`} may still exist; open Telegram and remove it before retrying.`);
    throw new Error(message);
  } finally {
    if (client) await closeClient(client);
  }
}

export function inspectTelegramAccountToken(token: string): TelegramAccountSummary {
  const account = unseal<TelegramAccountToken>(token);
  if (account.kind !== "account" || Date.now() - account.createdAt > ACCOUNT_TTL_MS) throw new Error("The Telegram account session expired. Connect again.");
  return { id: account.userId, displayName: account.displayName, username: account.username };
}
