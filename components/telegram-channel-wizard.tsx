"use client";

import "@/app/styles/drops-studio.telegram.css";
import {
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RadioTower,
  Send,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

type TelegramAccount = {
  id: string;
  displayName: string;
  username?: string;
};

type ChannelResult = {
  id: string;
  title: string;
  username?: string;
  url: string;
  botUsername: string;
  botAdded: boolean;
  firstPostSent: boolean;
  firstPostMessageId: number;
  dmSent: boolean;
  dmStartUrl: string;
  warnings: string[];
  accountToken: string;
};

type Phase = "loading" | "phone" | "code" | "password" | "connected" | "creating" | "created";

const ACCOUNT_STORAGE_KEY = "drops-studio:telegram-account";

function requestError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

function sessionHeaders() {
  let session = window.sessionStorage.getItem("drops-studio:guest-id") || "";
  if (!session) {
    session = crypto.randomUUID();
    window.sessionStorage.setItem("drops-studio:guest-id", session);
  }
  return { "content-type": "application/json", "x-drops-session": session };
}

export function TelegramChannelWizard({
  defaultTitle = "My Alpha Channel",
  defaultAbout = "Crypto intelligence prepared with Drops Studio and DropsTab context.",
  defaultFirstPost = "Welcome. This Telegram channel is live. Drops Bot alert Profiles remain a separate guided setup.",
  projectContext,
}: {
  defaultTitle?: string;
  defaultAbout?: string;
  defaultFirstPost?: string;
  projectContext?: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [flowToken, setFlowToken] = useState("");
  const [delivery, setDelivery] = useState<"telegram" | "sms">("telegram");
  const [account, setAccount] = useState<TelegramAccount | null>(null);
  const [accountToken, setAccountToken] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [about, setAbout] = useState(defaultAbout);
  const [username, setUsername] = useState("");
  const [firstPost, setFirstPost] = useState(defaultFirstPost);
  const [ownBot, setOwnBot] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [creationRequestId, setCreationRequestId] = useState("");
  const [dropsBotProfile, setDropsBotProfile] = useState("Main");
  const [profileCommandCopied, setProfileCommandCopied] = useState(false);
  const [result, setResult] = useState<ChannelResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.sessionStorage.getItem(ACCOUNT_STORAGE_KEY) || "";
    if (!saved) {
      const timer = window.setTimeout(() => {
        setCheckingExisting(false);
        setPhase("phone");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    void fetch("/api/telegram/account/status", {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ accountToken: saved }),
    })
      .then((response) => response.json())
      .then((payload: { connected?: boolean; account?: TelegramAccount }) => {
        if (!payload.connected || !payload.account) throw new Error("Expired");
        setAccount(payload.account);
        setAccountToken(saved);
        setCheckingExisting(false);
        setPhase("connected");
      })
      .catch(() => {
        window.sessionStorage.removeItem(ACCOUNT_STORAGE_KEY);
        setAccountToken("");
        setCheckingExisting(false);
        setPhase("phone");
      });
  }, []);

  async function sendCode() {
    setError("");
    setPhase("loading");
    try {
      const response = await fetch("/api/telegram/account/send-code", {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({ phoneNumber }),
      });
      const payload = await response.json() as { flowToken?: string; delivery?: "telegram" | "sms"; error?: string };
      if (!response.ok || !payload.flowToken) throw new Error(requestError(payload, "Telegram could not send a sign-in code."));
      setFlowToken(payload.flowToken);
      setDelivery(payload.delivery === "sms" ? "sms" : "telegram");
      setPhase("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram could not send a sign-in code.");
      setPhase("phone");
    }
  }

  async function signIn(includePassword = false) {
    setError("");
    setPhase("loading");
    try {
      const response = await fetch("/api/telegram/account/sign-in", {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({ flowToken, phoneCode, ...(includePassword ? { password } : {}) }),
      });
      const payload = await response.json() as { requiresPassword?: boolean; flowToken?: string; account?: TelegramAccount; accountToken?: string; error?: string };
      if (!response.ok) throw new Error(requestError(payload, "Telegram sign-in failed."));
      if (payload.requiresPassword && payload.flowToken) {
        setFlowToken(payload.flowToken);
        setPhase("password");
        return;
      }
      if (!payload.account || !payload.accountToken) throw new Error("Telegram did not return an account session.");
      window.sessionStorage.setItem(ACCOUNT_STORAGE_KEY, payload.accountToken);
      setAccount(payload.account);
      setAccountToken(payload.accountToken);
      setPassword("");
      setPhase("connected");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram sign-in failed.");
      setPhase(includePassword ? "password" : "code");
    }
  }

  async function createChannel() {
    setError("");
    setPhase("creating");
    const requestId = creationRequestId || crypto.randomUUID();
    if (!creationRequestId) setCreationRequestId(requestId);
    try {
      const response = await fetch("/api/telegram/account/create-channel", {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({ accountToken, requestId, title, about, username, firstPost, ...(ownBot ? { botToken } : {}) }),
      });
      const payload = await response.json() as ChannelResult & { error?: string };
      if (!response.ok || !payload.url || !Number.isSafeInteger(payload.firstPostMessageId) || payload.firstPostMessageId <= 0) {
        throw new Error(requestError(payload, "Telegram did not return verifiable evidence for the first channel post."));
      }
      window.sessionStorage.setItem(ACCOUNT_STORAGE_KEY, payload.accountToken);
      window.sessionStorage.setItem("drops-studio:telegram-last-channel", JSON.stringify({
        title: payload.title,
        url: payload.url,
        botUsername: payload.botUsername,
        firstPostMessageId: payload.firstPostMessageId,
      }));
      setAccountToken(payload.accountToken);
      setCreationRequestId("");
      setResult(payload);
      setPhase("created");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram could not create the channel.");
      setPhase("connected");
    }
  }

  function disconnect() {
    window.sessionStorage.removeItem(ACCOUNT_STORAGE_KEY);
    setAccount(null);
    setAccountToken("");
    setResult(null);
    setFlowToken("");
    setPhoneCode("");
    setPassword("");
    setCreationRequestId("");
    setPhase("phone");
  }

  return (
    <section
      className="telegram-wizard"
      aria-label="Create a real Telegram channel"
      data-project-context={projectContext}
    >
      <div className="telegram-wizard-intro">
        <span><RadioTower /></span>
        <div>
          <b>REAL TELEGRAM DELIVERY</b>
          <h3>Create the channel — not a mockup</h3>
          <p>Drops Studio creates a real channel from your connected Telegram account, adds the selected Telegram bot as an admin and publishes the first post. Official Drops Bot Profiles are linked separately.</p>
        </div>
      </div>

      <div className="telegram-steps" aria-label="Telegram channel setup progress">
        <span className={phase !== "phone" && phase !== "loading" ? "done" : "active"}><i>{phase !== "phone" && phase !== "loading" ? <Check /> : "1"}</i><b>Connect account</b></span>
        <span className={["connected", "creating", "created"].includes(phase) ? "active" : ""}><i>{phase === "created" ? <Check /> : "2"}</i><b>Configure</b></span>
        <span className={phase === "created" ? "done" : ""}><i>{phase === "created" ? <Check /> : "3"}</i><b>Live channel</b></span>
      </div>

      {error && <div className="telegram-error"><CircleAlert /><span>{error}</span></div>}

      {checkingExisting && <div className="telegram-auth-card"><div className="telegram-auth-copy"><LoaderCircle className="spin" /><div><strong>Checking Telegram connection</strong><p>Restoring the encrypted session from this browser tab.</p></div></div></div>}

      {!checkingExisting && (phase === "phone" || phase === "loading" && !flowToken && !account) && (
        <div className="telegram-auth-card">
          <div className="telegram-auth-copy"><UserRoundCheck /><div><strong>Connect your Telegram account</strong><p>Required once because Telegram allows only user accounts—not bots—to create channels.</p></div></div>
          <label><span>Phone number with country code</span><input type="tel" autoComplete="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+44 7700 900000" /></label>
          <button type="button" className="telegram-primary" onClick={() => void sendCode()} disabled={phase === "loading" || !phoneNumber.trim()}>{phase === "loading" ? <LoaderCircle className="spin" /> : <Send />} Send secure code</button>
          <small><LockKeyhole /> The encrypted session stays only in this browser tab and expires automatically.</small>
        </div>
      )}

      {(phase === "code" || phase === "loading" && Boolean(flowToken) && !account && !password) && (
        <div className="telegram-auth-card">
          <div className="telegram-auth-copy"><KeyRound /><div><strong>Enter the code</strong><p>Telegram sent it via {delivery === "telegram" ? "the Telegram app" : "SMS"}.</p></div></div>
          <label><span>Telegram code</span><input inputMode="numeric" autoComplete="one-time-code" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="12345" /></label>
          <button type="button" className="telegram-primary" onClick={() => void signIn()} disabled={phase === "loading" || phoneCode.length < 3}>{phase === "loading" ? <LoaderCircle className="spin" /> : <BadgeCheck />} Verify account</button>
          <button type="button" className="telegram-link-button" onClick={() => { setFlowToken(""); setPhoneCode(""); setPhase("phone"); }}>Use another number</button>
        </div>
      )}

      {(phase === "password" || phase === "loading" && Boolean(password)) && (
        <div className="telegram-auth-card">
          <div className="telegram-auth-copy"><LockKeyhole /><div><strong>Two-step verification</strong><p>This account is protected by a Telegram cloud password.</p></div></div>
          <label><span>Telegram password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="button" className="telegram-primary" onClick={() => void signIn(true)} disabled={phase === "loading" || !password}>{phase === "loading" ? <LoaderCircle className="spin" /> : <BadgeCheck />} Finish connection</button>
        </div>
      )}

      {(["connected", "creating"].includes(phase)) && account && (
        <div className="telegram-channel-builder">
          <div className="telegram-account-row"><span><UserRoundCheck /></span><div><strong>{account.displayName}</strong><small>{account.username || "Telegram account connected"}</small></div><b>CONNECTED</b><button type="button" onClick={disconnect}>Change</button></div>
          <div className="telegram-form-grid">
            <label><span>Channel name</span><input value={title} maxLength={64} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>Public username <i>optional</i></span><div className="telegram-username"><b>@</b><input value={username} maxLength={32} onChange={(event) => setUsername(event.target.value.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, ""))} placeholder="my_alpha_channel" /></div></label>
          </div>
          <label><span>Channel description</span><textarea rows={2} maxLength={255} value={about} onChange={(event) => setAbout(event.target.value)} /></label>
          <label><span>First real post</span><textarea rows={5} maxLength={3500} value={firstPost} onChange={(event) => setFirstPost(event.target.value)} /></label>
          <div className="telegram-bot-choice">
            <button type="button" className={!ownBot ? "active" : ""} onClick={() => setOwnBot(false)}><Sparkles /><span><strong>Drops Studio bot</strong><small>Uses the configured platform bot</small></span>{!ownBot && <Check />}</button>
            <button type="button" className={ownBot ? "active" : ""} onClick={() => setOwnBot(true)}><Bot /><span><strong>My BotFather bot</strong><small>Use your own identity</small></span>{ownBot && <Check />}</button>
          </div>
          {ownBot && <label><span>BotFather token</span><input type="password" autoComplete="off" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA…" /></label>}
          <div className="telegram-dm-note"><Bot /><span><strong>Want the result in a bot DM?</strong><small>After creation, use the returned link for the exact selected bot. Telegram blocks unsolicited bot messages.</small></span></div>
          <button type="button" className="telegram-create" onClick={() => void createChannel()} disabled={phase === "creating" || title.trim().length < 2 || !firstPost.trim() || ownBot && !botToken.trim()}>{phase === "creating" ? <><LoaderCircle className="spin" /> Creating channel, adding bot and publishing…</> : <><RadioTower /> Create real Telegram channel <ChevronRight /></>}</button>
          <p className="telegram-consent">This creates an external Telegram channel and adds the selected bot as administrator only when you press the button.</p>
        </div>
      )}

      {phase === "created" && result && (
        <div className="telegram-success">
          <div className="telegram-success-hero"><span><BadgeCheck /></span><div><b>CHANNEL IS LIVE</b><h3>{result.title}</h3><p>{result.username || "Private channel with shareable invite"}</p></div></div>
          <div className="telegram-success-checks"><span><Check /> Real channel created</span><span><Check /> {result.botUsername} is admin</span><span><Check /> First post #{result.firstPostMessageId} confirmed by Telegram</span><span className={result.dmSent ? "" : "pending"}>{result.dmSent ? <Check /> : <CircleAlert />} {result.dmSent ? "Result sent in DM" : "Start bot to receive future DMs"}</span></div>
          {result.warnings?.map((warning) => <div className="telegram-success-warning" key={warning}><CircleAlert /><span>{warning}</span></div>)}
          <div className="telegram-dm-note">
            <Bot />
            <span>
              <strong>Optional official Drops Bot Profile</strong>
              <small>Open your active Drops Bot, send /profiles in its private chat, add that same bot to this channel, then send the command below. Only the user who added the bot can link their Profiles. Copying the command does not claim configuration succeeded.</small>
              <label>
                <span>Profile name</span>
                <input value={dropsBotProfile} maxLength={64} onChange={(event) => { setDropsBotProfile(event.target.value.replace(/[\r\n]/g, "")); setProfileCommandCopied(false); }} />
              </label>
            </span>
            <a href="https://t.me/Drops" target="_blank" rel="noreferrer">Open @Drops <ExternalLink /></a>
            <button
              type="button"
              disabled={!dropsBotProfile.trim()}
              onClick={() => {
                const command = `/use_thread ${dropsBotProfile.trim()}`;
                if (!navigator.clipboard?.writeText) {
                  setProfileCommandCopied(false);
                  setError(`Clipboard access is unavailable. Copy this command manually: ${command}`);
                  return;
                }
                void navigator.clipboard.writeText(command)
                  .then(() => {
                    setProfileCommandCopied(true);
                    setError("");
                  })
                  .catch(() => {
                    setProfileCommandCopied(false);
                    setError(`Automatic copy failed. Copy this command manually: ${command}`);
                  });
              }}
            >
              {profileCommandCopied ? <Check /> : <Bot />} {profileCommandCopied ? "Command copied" : "Copy /use_thread command"}
            </button>
          </div>
          <div className="telegram-success-actions"><a href={result.url} target="_blank" rel="noreferrer"><ExternalLink /> Open live channel</a>{!result.dmSent && <a className="secondary" href={result.dmStartUrl} target="_blank" rel="noreferrer"><Bot /> Start bot</a>}<button type="button" onClick={() => { setCreationRequestId(""); setResult(null); setPhase("connected"); }}>Create another</button></div>
        </div>
      )}
    </section>
  );
}
