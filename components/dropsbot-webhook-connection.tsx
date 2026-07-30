"use client"

import "@/app/styles/tailwind.css"

import { useCallback, useEffect, useState } from "react"
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface DropsBotWebhookEventView {
  id: string
  receivedAt: string
  contentHash: string
  payload: Record<string, unknown>
}

interface DropsBotCallbackEvidenceView {
  status: "pending" | "callback-received"
  providerVerified: false
  providerSignatureVerified: false
  receivedAt?: string
}

interface DropsBotWebhookConnectionProps {
  projectId: string
  onToast: (message: string) => void
}

export function DropsBotWebhookConnection({
  projectId,
  onToast,
}: DropsBotWebhookConnectionProps) {
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState("")
  const [events, setEvents] = useState<DropsBotWebhookEventView[]>([])
  const [evidence, setEvidence] = useState<DropsBotCallbackEvidenceView | null>(null)
  const [message, setMessage] = useState("")
  const [canCreate, setCanCreate] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/dropsbot/events?projectId=${encodeURIComponent(projectId)}&limit=20`,
        { credentials: "same-origin", cache: "no-store" },
      )
      const payload = (await response.json().catch(() => ({}))) as {
        events?: DropsBotWebhookEventView[]
        callbackEvidence?: DropsBotCallbackEvidenceView
        error?: string
        code?: string
      }
      if (response.status === 404) {
        setCanCreate(true)
        setEvidence(null)
        setEvents([])
        setMessage("No callback exists yet. Create one, then register its one-time URL inside the official @drops bot.")
        return
      }
      if (response.status === 401) {
        setCallbackUrl("")
        setEvidence(null)
        setEvents([])
        setConsent(false)
        setCanCreate(false)
        setMessage("Connect a signed Studio account before creating an owner-scoped Drops Bot callback.")
        return
      }
      if (!response.ok) throw new Error(payload.error || "Callback events are unavailable.")
      setCanCreate(false)
      setEvidence(payload.callbackEvidence ?? null)
      setEvents(Array.isArray(payload.events) ? payload.events : [])
      setMessage("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Callback events are unavailable.")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refresh])

  async function createCallback() {
    if (!consent || creating) return
    setCreating(true)
    setMessage("")
    try {
      const response = await fetch("/api/dropsbot/webhooks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, consent: true }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        callbackUrl?: string
        callbackEvidence?: DropsBotCallbackEvidenceView
        error?: string
      }
      if (response.status === 401) {
        setCallbackUrl("")
        setEvidence(null)
        setEvents([])
        setConsent(false)
        setCanCreate(false)
      }
      if (!response.ok || !payload.callbackUrl) {
        throw new Error(payload.error || "Drops Bot callback could not be created.")
      }
      setCallbackUrl(payload.callbackUrl)
      setEvidence(payload.callbackEvidence ?? null)
      setCanCreate(false)
      setConsent(false)
      setMessage(
        "Copy this URL now. Its secret is shown once. Registration still happens inside the official @drops API screen.",
      )
      onToast("Drops Bot callback created — copy the one-time URL")
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Drops Bot callback could not be created."
      setMessage(errorMessage)
      onToast(errorMessage)
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="my-3 overflow-hidden rounded-xl border border-border bg-background text-foreground" aria-label="Drops Bot API connection">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/35 px-4 py-3">
        <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Webhook className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm">Drops Bot webhook receiver</strong>
          <span className="text-sm text-muted-foreground">
            Wallet, swap, and tracked-event delivery · official free tier: 20 wallets / 10,000 callbacks monthly
          </span>
        </div>
        {evidence?.status === "callback-received" ? (
          <Badge className="bg-emerald-600 text-white">
            <ShieldCheck data-icon="inline-start" aria-hidden="true" />
            Callback received · provider unverified
          </Badge>
        ) : evidence ? (
          <Badge variant="outline">Awaiting first callback</Badge>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" className="size-11" aria-label="Refresh callback events" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </header>

      <div className="space-y-3 p-4">
        {loading ? (
          <p className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Checking owner-scoped callback evidence…
          </p>
        ) : null}

        {callbackUrl ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <strong className="text-sm">One-time callback URL</strong>
            <code className="block break-all rounded-md bg-white p-3 text-sm leading-6">{callbackUrl}</code>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!navigator.clipboard?.writeText) {
                    onToast("Clipboard access is unavailable")
                    return
                  }
                  void navigator.clipboard.writeText(callbackUrl)
                    .then(() => onToast("Callback URL copied"))
                    .catch(() => onToast("Could not copy callback URL"))
                }}
              >
                <Copy data-icon="inline-start" aria-hidden="true" />
                Copy callback
              </Button>
              <Button type="button" variant="outline" size="sm" render={<a href="https://t.me/Drops" target="_blank" rel="noreferrer" />}>
                <ExternalLink data-icon="inline-start" aria-hidden="true" />
                Open official @drops
              </Button>
            </div>
          </div>
        ) : null}

        {canCreate ? (
          <div className="space-y-3">
            <Label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
              <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} aria-label="Consent to create a Drops Bot callback" />
              <span>
                Create a secret callback for this project and store incoming event payloads. I will register the URL myself inside @drops.
              </span>
            </Label>
            <Button type="button" className="w-full" disabled={!consent || creating} onClick={() => void createCallback()}>
              {creating ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Bot data-icon="inline-start" aria-hidden="true" />}
              Create owner-scoped callback
            </Button>
          </div>
        ) : null}

        {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}

        {evidence ? (
          <div className="grid gap-2 rounded-lg border border-border bg-muted/25 p-3 text-sm">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-emerald-600" aria-hidden="true" />
              Capability URL authentication enabled
            </span>
            <span className="text-muted-foreground">
              Provider identity and signature: unverified because the public specification defines neither
            </span>
            {evidence.receivedAt ? (
              <span className="text-muted-foreground">
                Last capability-authenticated callback: {new Date(evidence.receivedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        ) : null}

        {events.length ? (
          <div className="space-y-2">
            <strong className="text-sm">Recent sanitized events</strong>
            {events.slice(0, 5).map((event) => (
              <details key={event.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">
                  {String(event.payload.event ?? event.payload.type ?? "Unverified callback event")} · {new Date(event.receivedAt).toLocaleString()}
                </summary>
                <pre className="overflow-auto whitespace-pre-wrap pb-3 font-mono text-sm leading-6 text-muted-foreground">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
