"use client";

import { BadgeCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

type CallbackState = "working" | "success" | "error";

export default function OpenRouterCallbackPage() {
  const [state, setState] = useState<CallbackState>("working");
  const [message, setMessage] = useState("Finishing your secure OpenRouter connection…");

  useEffect(() => {
    const exchange = async () => {
      const callbackUrl = new URL(window.location.href);
      const code = callbackUrl.searchParams.get("code") ?? "";
      callbackUrl.searchParams.delete("code");
      window.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      const verifier = window.sessionStorage.getItem("drops-studio:openrouter:pkce") ?? "";
      if (!code || !verifier) {
        setState("error");
        setMessage("The authorization code or this tab’s verifier is missing. Start the connection again from Drops Studio.");
        return;
      }

      try {
        const response = await fetch("/api/auth/openrouter/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, codeVerifier: verifier }),
        });
        const payload = await response.json() as { key?: string; error?: string };
        if (!response.ok || !payload.key) throw new Error(payload.error ?? "OpenRouter connection failed.");

        window.sessionStorage.removeItem("drops-studio:openrouter:pkce");
        window.sessionStorage.setItem("drops-studio:openrouter", payload.key);
        window.sessionStorage.setItem("drops-studio:openrouter:model", "openrouter/free");
        window.sessionStorage.setItem("drops-studio:active-brain", "openrouter");
        setState("success");
        setMessage("OpenRouter is connected. Returning to Drops Studio…");
        window.setTimeout(() => window.location.replace("/?connections=1&openrouter=connected"), 650);
      } catch (error) {
        setState("error");
        setMessage(error instanceof Error ? error.message : "OpenRouter connection failed.");
      }
    };
    void exchange();
  }, []);

  return (
    <main className="oauth-screen">
      <section className="oauth-card" aria-live="polite">
        <div className={`oauth-icon ${state}`}>
          {state === "working" ? <LoaderCircle className="spin" /> : state === "success" ? <BadgeCheck /> : <TriangleAlert />}
        </div>
        <span>DROPS STUDIO × OPENROUTER</span>
        <h1>{state === "working" ? "Connecting your AI brain" : state === "success" ? "Connection ready" : "Connection needs attention"}</h1>
        <p>{message}</p>
        {state === "error" && <button type="button" onClick={() => window.location.assign("/?connections=1")}>Return to AI Connections</button>}
      </section>
    </main>
  );
}
