"use client"

import "@/app/styles/tailwind.css"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ArrowUpRight,
  Check,
  Copy,
  CreditCard,
  Crown,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  materializeMemberProject,
  memberProjectDraft,
} from "@/lib/member-project-sync-client"
import type { BillingEntitlements, BillingSubscriptionStatus, BillingTier } from "@/lib/billing"
import type { GeneratedProject } from "@/lib/project-types"
import type {
  TeamInvite,
  TeamRole,
  TeamSharedProject,
  TeamWorkspace,
} from "@/lib/team-workspaces"

interface StudioAccountTeamPanelProps {
  project: GeneratedProject
  onApplyProject: (project: GeneratedProject) => boolean | Promise<boolean>
  onToast: (message: string) => void
}

interface BillingStatus {
  tier: BillingTier
  entitlements: BillingEntitlements
  billing: {
    status: BillingSubscriptionStatus
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
  }
}

interface ApiPayload {
  accountIdentity?: string
  billing?: BillingStatus["billing"]
  capability?: string
  checkoutUrl?: string
  code?: string
  current?: TeamWorkspace
  currentProject?: TeamSharedProject
  entitlements?: BillingEntitlements
  error?: string
  invite?: TeamInvite
  portalUrl?: string
  project?: TeamSharedProject
  status?: string
  tier?: BillingTier
  workspace?: TeamWorkspace
  workspaces?: TeamWorkspace[]
}

interface OneTimeInvite {
  capability: string
  expiresAt: string
  role: Exclude<TeamRole, "owner">
  workspaceName: string
}

interface OptimisticRevision {
  workspaceId: string
  workspaceRevision: number
  projectRevision: number
}

type LoadState = "loading" | "ready" | "signed-out"
type PendingAction =
  | "accept-invite"
  | "apply-project"
  | "billing-checkout"
  | "billing-portal"
  | "create-invite"
  | "create-team"
  | "share-project"
  | "update-member-role"
  | null

function uniqueWorkspaces(items: TeamWorkspace[]): TeamWorkspace[] {
  const byId = new Map<string, TeamWorkspace>()
  for (const workspace of items) byId.set(workspace.id, workspace)
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function shortIdentity(identity: string): string {
  return identity.length > 18
    ? `${identity.slice(0, 8)}…${identity.slice(-6)}`
    : identity
}

function currentRole(workspace: TeamWorkspace, accountIdentity: string): TeamRole | null {
  return workspace.members.find((member) => member.identity === accountIdentity)?.role ?? null
}

function readableDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not scheduled"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

async function responsePayload(response: Response): Promise<ApiPayload> {
  return response
    .json()
    .then((value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? value as ApiPayload
        : {},
    )
    .catch(() => ({}))
}

function apiError(payload: ApiPayload, fallback: string): string {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : fallback
}

function verifiedStripeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (hostname !== "stripe.com" && !hostname.endsWith(".stripe.com"))
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function actionLabel(action: PendingAction, target: PendingAction, label: string) {
  return action === target ? (
    <>
      <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" />
      {label}
    </>
  ) : null
}

export function StudioAccountTeamPanel({
  project,
  onApplyProject,
  onToast,
}: StudioAccountTeamPanelProps) {
  const teamNameId = useId()
  const inviteCapabilityId = useId()
  const requestVersion = useRef(0)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [billingMessage, setBillingMessage] = useState("")
  const [accountIdentity, setAccountIdentity] = useState("")
  const [workspaces, setWorkspaces] = useState<TeamWorkspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("")
  const [teamMessage, setTeamMessage] = useState("")
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [billingConsent, setBillingConsent] = useState(false)
  const [teamName, setTeamName] = useState("")
  const [createTeamConsent, setCreateTeamConsent] = useState(false)
  const [teamConsent, setTeamConsent] = useState(false)
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, "owner">>("editor")
  const [pendingMemberIdentity, setPendingMemberIdentity] = useState("")
  const [oneTimeInvite, setOneTimeInvite] = useState<OneTimeInvite | null>(null)
  const [inviteCapability, setInviteCapability] = useState("")
  const [acceptConsent, setAcceptConsent] = useState(false)
  const [applyConsent, setApplyConsent] = useState(false)
  const [selectedTeamProjectId, setSelectedTeamProjectId] = useState("")
  const [shareConsent, setShareConsent] = useState(false)
  const [shareMessage, setShareMessage] = useState("")
  const [optimisticRevision, setOptimisticRevision] = useState<OptimisticRevision | null>(null)

  const clearSensitiveState = useCallback(() => {
    setBillingConsent(false)
    setTeamName("")
    setCreateTeamConsent(false)
    setTeamConsent(false)
    setInviteRole("editor")
    setPendingMemberIdentity("")
    setOneTimeInvite(null)
    setInviteCapability("")
    setAcceptConsent(false)
    setApplyConsent(false)
    setSelectedTeamProjectId("")
    setShareConsent(false)
    setShareMessage("")
    setOptimisticRevision(null)
    setPendingAction(null)
  }, [])

  const markSignedOut = useCallback(() => {
    clearSensitiveState()
    setBilling(null)
    setBillingMessage("")
    setAccountIdentity("")
    setWorkspaces([])
    setSelectedWorkspaceId("")
    setTeamMessage("")
    setLoadState("signed-out")
  }, [clearSensitiveState])

  const handleUnauthorizedResponse = useCallback((response: Response) => {
    if (response.status !== 401) return false
    markSignedOut()
    onToast("Signed Studio account required — sensitive team state cleared")
    return true
  }, [markSignedOut, onToast])

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null,
    [selectedWorkspaceId, workspaces],
  )
  const role = selectedWorkspace && accountIdentity
    ? currentRole(selectedWorkspace, accountIdentity)
    : null
  const canManage = role === "owner"
  const canWrite = role === "owner" || role === "editor"
  const sharedProject = selectedWorkspace?.projects.find((item) => item.projectId === project.id) ?? null
  const applicableProject = selectedWorkspace?.projects.find(
    (item) => item.projectId === selectedTeamProjectId,
  ) ?? sharedProject ?? selectedWorkspace?.projects[0] ?? null
  const signedOut = loadState === "signed-out"
  const teamMessageIsError = /unavailable|required|could not|invalid|expired|changed elsewhere|not created/i.test(teamMessage)

  const replaceWorkspace = useCallback((workspace: TeamWorkspace) => {
    setWorkspaces((current) => uniqueWorkspaces([
      ...current.filter((item) => item.id !== workspace.id),
      workspace,
    ]))
    setSelectedWorkspaceId(workspace.id)
    setApplyConsent(false)
  }, [])

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoadState("loading")
    setBillingMessage("")
    setTeamMessage("")
    try {
      const [billingResponse, teamsResponse] = await Promise.all([
        fetch("/api/billing/status", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
          cache: "no-store",
        }),
        fetch("/api/teams", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
          cache: "no-store",
        }),
      ])
      const [billingPayload, teamsPayload] = await Promise.all([
        responsePayload(billingResponse),
        responsePayload(teamsResponse),
      ])
      if (version !== requestVersion.current) return
      if (billingResponse.status === 401 || teamsResponse.status === 401) {
        markSignedOut()
        return
      }
      if (billingResponse.ok && billingPayload.tier && billingPayload.entitlements && billingPayload.billing) {
        setBilling({
          tier: billingPayload.tier,
          entitlements: billingPayload.entitlements,
          billing: billingPayload.billing,
        })
      } else {
        setBilling(null)
        setBillingMessage(apiError(billingPayload, "Billing status is unavailable."))
      }
      if (teamsResponse.ok) {
        const nextWorkspaces = Array.isArray(teamsPayload.workspaces)
          ? uniqueWorkspaces(teamsPayload.workspaces)
          : []
        setAccountIdentity(typeof teamsPayload.accountIdentity === "string" ? teamsPayload.accountIdentity : "")
        setWorkspaces(nextWorkspaces)
        setSelectedWorkspaceId((current) =>
          nextWorkspaces.some((workspace) => workspace.id === current)
            ? current
            : nextWorkspaces[0]?.id ?? "",
        )
      } else {
        setAccountIdentity("")
        setWorkspaces([])
        setTeamMessage(apiError(teamsPayload, "Team workspaces are unavailable."))
      }
      setLoadState("ready")
    } catch {
      if (version !== requestVersion.current) return
      setBilling(null)
      setWorkspaces([])
      setBillingMessage("Account services could not be reached.")
      setTeamMessage("Team workspaces could not be reached.")
      setLoadState("ready")
    }
  }, [markSignedOut])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestVersion.current += 1
    }
  }, [refresh])

  async function openBilling(destination: "checkout" | "portal") {
    if (!billingConsent || pendingAction || signedOut) return
    const action = destination === "checkout" ? "billing-checkout" : "billing-portal"
    setPendingAction(action)
    setBillingMessage("")
    try {
      const response = await fetch(`/api/billing/${destination}`, {
        method: "POST",
        credentials: "same-origin",
        headers: destination === "checkout"
          ? { accept: "application/json", "content-type": "application/json" }
          : { accept: "application/json" },
        ...(destination === "checkout" ? { body: JSON.stringify({ consent: true }) } : {}),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      const providerUrl = verifiedStripeUrl(
        destination === "checkout" ? payload.checkoutUrl : payload.portalUrl,
      )
      if (!response.ok || !providerUrl) {
        throw new Error(apiError(payload, `Stripe ${destination} is unavailable.`))
      }
      setBillingConsent(false)
      onToast(destination === "checkout" ? "Opening verified Stripe checkout" : "Opening verified Stripe billing portal")
      window.location.assign(providerUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe billing is unavailable."
      setBillingMessage(message)
      onToast(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function createTeam() {
    if (!createTeamConsent || billing?.tier !== "pro" || pendingAction || signedOut) return
    setPendingAction("create-team")
    setTeamMessage("")
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name: teamName, consent: true }),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      if (!response.ok || !payload.workspace) {
        const message = payload.code === "PRO_REQUIRED"
          ? "A verified active Pro subscription is required before creating a team."
          : apiError(payload, "Team workspace could not be created.")
        throw new Error(message)
      }
      replaceWorkspace(payload.workspace)
      setTeamName("")
      setCreateTeamConsent(false)
      setTeamMessage("Team created from a verified server revision.")
      onToast(`Team “${payload.workspace.name}” created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Team workspace could not be created."
      setTeamMessage(message)
      onToast(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function createInvite() {
    if (!selectedWorkspace || !canManage || !teamConsent || pendingAction || signedOut) return
    setPendingAction("create-invite")
    setTeamMessage("")
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(selectedWorkspace.id)}/invites`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          ownerIdentity: selectedWorkspace.ownerIdentity,
          expectedRevision: selectedWorkspace.revision,
          role: inviteRole,
          expiresInHours: 168,
          consent: true,
        }),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      if (response.status === 409 && payload.current) {
        replaceWorkspace(payload.current)
        throw new Error("Invite was not created: the team changed elsewhere. The newest revision is loaded; review it and try again.")
      }
      if (!response.ok || !payload.workspace || !payload.invite || !payload.capability) {
        throw new Error(apiError(payload, "Team invite could not be created."))
      }
      replaceWorkspace(payload.workspace)
      setOneTimeInvite({
        capability: payload.capability,
        expiresAt: payload.invite.expiresAt,
        role: payload.invite.role,
        workspaceName: payload.workspace.name,
      })
      setTeamConsent(false)
      setTeamMessage("Copy the invite now. The capability is held only in this open panel and is not persisted by the client.")
      onToast(`${payload.invite.role} invite created — copy it now`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Team invite could not be created."
      setTeamMessage(message)
      onToast(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function acceptInvite() {
    if (!acceptConsent || !inviteCapability.trim() || pendingAction || signedOut) return
    setPendingAction("accept-invite")
    setTeamMessage("")
    try {
      const response = await fetch("/api/teams/invites/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ capability: inviteCapability.trim(), consent: true }),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      if (!response.ok || !payload.workspace) {
        throw new Error(apiError(payload, "Team invite is invalid, expired, or unavailable."))
      }
      replaceWorkspace(payload.workspace)
      setInviteCapability("")
      setAcceptConsent(false)
      setTeamMessage(payload.status === "already-accepted"
        ? "This signed account had already accepted the invite. The verified team revision is loaded."
        : "Invite accepted with explicit consent. The verified team revision is loaded.")
      onToast(payload.status === "already-accepted" ? "Team invite already accepted" : "Team invite accepted")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Team invite could not be accepted."
      setTeamMessage(message)
      onToast(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function applySharedProject() {
    if (!applicableProject || !applyConsent || pendingAction || signedOut) return
    setPendingAction("apply-project")
    try {
      const materialized = await materializeMemberProject({
        schemaVersion: 1,
        ...applicableProject.draft,
        revision: applicableProject.revision,
        createdAt: applicableProject.createdAt,
        updatedAt: applicableProject.updatedAt,
      })
      const applied = await onApplyProject(materialized)
      if (!applied) {
        throw new Error("Shared source could not be saved in this browser.")
      }
      setApplyConsent(false)
      setShareMessage(
        `Applied verified shared source revision ${applicableProject.revision} locally. No team revision was changed.`,
      )
      onToast(`Shared source revision ${applicableProject.revision} opened locally`)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Shared source revision could not be materialized safely."
      setShareMessage(`Apply failed; the local project was not changed. ${message}`)
      onToast(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function shareProject() {
    if (!selectedWorkspace || !canWrite || !shareConsent || pendingAction || signedOut) return
    const nextRevision = {
      workspaceId: selectedWorkspace.id,
      workspaceRevision: selectedWorkspace.revision + 1,
      projectRevision: (sharedProject?.revision ?? 0) + 1,
    }
    setPendingAction("share-project")
    setOptimisticRevision(nextRevision)
    setShareMessage(`Saving optimistic team revision ${nextRevision.workspaceRevision} / project revision ${nextRevision.projectRevision}…`)
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(selectedWorkspace.id)}/projects`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          ownerIdentity: selectedWorkspace.ownerIdentity,
          expectedWorkspaceRevision: selectedWorkspace.revision,
          expectedProjectRevision: sharedProject?.revision ?? 0,
          project: memberProjectDraft(project),
          consent: true,
        }),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      if (response.status === 409 && payload.current) {
        replaceWorkspace(payload.current)
        const projectRevision = payload.currentProject?.revision ?? 0
        setShareMessage(
          `Revision conflict: the server is at team revision ${payload.current.revision} / project revision ${projectRevision}. No local overwrite occurred. Review and share again.`,
        )
        onToast("Team project changed elsewhere — newest revision loaded")
        return
      }
      if (!response.ok || !payload.workspace || !payload.project) {
        throw new Error(apiError(payload, "Project could not be shared with the team."))
      }
      replaceWorkspace(payload.workspace)
      setShareConsent(false)
      setShareMessage(
        `Verified server receipt: team revision ${payload.workspace.revision} / project revision ${payload.project.revision}.`,
      )
      onToast(`Project shared at revision ${payload.project.revision}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project could not be shared with the team."
      setShareMessage(`Share failed; the last verified revision remains unchanged. ${message}`)
      onToast(message)
    } finally {
      setOptimisticRevision(null)
      setPendingAction(null)
    }
  }

  async function updateMemberRole(
    memberIdentity: string,
    nextRole: Exclude<TeamRole, "owner">,
  ) {
    if (
      !selectedWorkspace
      || !canManage
      || !teamConsent
      || pendingAction
      || signedOut
    ) {
      return
    }
    setPendingAction("update-member-role")
    setPendingMemberIdentity(memberIdentity)
    setTeamMessage("")
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(selectedWorkspace.id)}/members`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          ownerIdentity: selectedWorkspace.ownerIdentity,
          memberIdentity,
          role: nextRole,
          expectedRevision: selectedWorkspace.revision,
          consent: true,
        }),
      })
      const payload = await responsePayload(response)
      if (handleUnauthorizedResponse(response)) return
      if (response.status === 409 && payload.current) {
        replaceWorkspace(payload.current)
        throw new Error(
          "Role was not changed: the team changed elsewhere. The newest revision is loaded; review it and try again.",
        )
      }
      if (!response.ok || !payload.workspace) {
        throw new Error(apiError(payload, "Team member role could not be changed."))
      }
      replaceWorkspace(payload.workspace)
      setTeamConsent(false)
      setTeamMessage(
        `Verified server receipt: member role changed to ${nextRole} at team revision ${payload.workspace.revision}.`,
      )
      onToast(`Member role changed to ${nextRole}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Team member role could not be changed."
      setTeamMessage(message)
      onToast(message)
    } finally {
      setPendingMemberIdentity("")
      setPendingAction(null)
    }
  }

  return (
    <section
      className="@container/account-team my-4 space-y-4 rounded-2xl border border-border bg-background p-4 text-foreground"
      aria-labelledby={`${teamNameId}-heading`}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${teamNameId}-heading`} className="text-lg font-semibold">Account, billing &amp; team workspace</h2>
          <p className="text-base leading-7 text-muted-foreground">
            Verified access, explicit provider consent, revision-safe collaboration, and no hidden AI markup.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Refresh account and team status"
          onClick={() => void refresh()}
          disabled={loadState === "loading" || pendingAction !== null}
        >
          <RefreshCw className={loadState === "loading" ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </header>

      {loadState === "signed-out" ? (
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Signed Studio account required</AlertTitle>
          <AlertDescription>
            Connect a member account before reading billing status, accepting a team capability, or changing shared projects. No account or provider connection is being claimed here.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 @4xl/account-team:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="size-5 text-primary" aria-hidden="true" />
              Billing &amp; access
            </CardTitle>
            <CardDescription className="text-base leading-7">
              Stripe controls appear only after the signed-account status route responds.
            </CardDescription>
            {billing ? (
              <CardAction>
                <Badge variant={billing.tier === "pro" ? "default" : "secondary"}>
                  {billing.tier === "pro" ? "Verified Pro" : "Member"}
                </Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4 text-base">
            {loadState === "loading" ? (
              <p className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                Reading signed-account entitlements…
              </p>
            ) : billing ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/25 p-3">
                    <span className="text-sm font-medium">Platform builds</span>
                    <strong className="mt-1 block text-xl">{billing.entitlements.platformDailyBuilds}/day</strong>
                    <span className="text-sm text-muted-foreground">{billing.entitlements.privateProjects} private projects</span>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/25 p-3">
                    <span className="text-sm font-medium">Team capacity</span>
                    <strong className="mt-1 block text-xl">{billing.entitlements.teamWorkspaces}</strong>
                    <span className="text-sm text-muted-foreground">
                      {billing.entitlements.collaboratorsPerWorkspace} collaborators per workspace
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    BYOK · 0% Studio markup
                  </div>
                  <p className="mt-1 text-sm leading-6">
                    Provider billing stays with you; keys are request-only/session-only and are not stored in team projects. Supported: {billing.entitlements.byok.providers.join(", ")}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline">Stripe: {billing.billing.status}</Badge>
                  <span>Period end: {readableDate(billing.billing.currentPeriodEnd)}</span>
                  {billing.billing.cancelAtPeriodEnd ? <Badge variant="destructive">Cancels at period end</Badge> : null}
                </div>
                <Label className="cursor-pointer items-start text-sm leading-6">
                  <Checkbox
                    checked={billingConsent}
                    onCheckedChange={(checked) => setBillingConsent(checked === true)}
                    aria-label="Consent to open Stripe billing"
                  />
                  <span>I explicitly approve leaving Studio for the verified Stripe checkout or customer portal.</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {billing.tier === "pro" ? (
                    <Button
                      type="button"
                      onClick={() => void openBilling("portal")}
                      disabled={!billingConsent || billing.billing.status === "none" || pendingAction !== null}
                    >
                      {actionLabel(pendingAction, "billing-portal", "Opening portal…") ?? (
                        <>
                          <ArrowUpRight data-icon="inline-start" aria-hidden="true" />
                          Manage Pro in Stripe
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => void openBilling("checkout")}
                      disabled={!billingConsent || pendingAction !== null}
                    >
                      {actionLabel(pendingAction, "billing-checkout", "Opening checkout…") ?? (
                        <>
                          <Crown data-icon="inline-start" aria-hidden="true" />
                          Upgrade to Pro
                        </>
                      )}
                    </Button>
                  )}
                  {billing.billing.status !== "none" && billing.tier !== "pro" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void openBilling("portal")}
                      disabled={!billingConsent || pendingAction !== null}
                    >
                      <ArrowUpRight data-icon="inline-start" aria-hidden="true" />
                      Billing portal
                    </Button>
                  ) : null}
                </div>
                {billingMessage ? (
                  <Alert variant="destructive">
                    <AlertTitle>Billing action failed</AlertTitle>
                    <AlertDescription>{billingMessage}</AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-muted/25 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
                    BYOK policy · 0% Studio markup
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Provider-direct billing and session-only keys remain the product policy. Current billing tier is not verified while the status service is unavailable.
                  </p>
                </div>
                {billingMessage ? (
                  <Alert variant="destructive">
                    <AlertTitle>Billing status not verified</AlertTitle>
                    <AlertDescription>{billingMessage}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              Team workspaces
            </CardTitle>
            <CardDescription className="text-base leading-7">
              Owned and joined teams are loaded from the signed member index with server revisions.
            </CardDescription>
            <CardAction><Badge variant="outline">{workspaces.length} teams</Badge></CardAction>
          </CardHeader>
          <CardContent className="space-y-4 text-base">
            {billing?.tier === "pro" ? (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <Label htmlFor={teamNameId}>New Pro team name</Label>
                <Input
                  id={teamNameId}
                  className="h-11! min-h-11! text-sm!"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  minLength={2}
                  maxLength={80}
                  placeholder="Research desk"
                  autoComplete="off"
                />
                <Label className="cursor-pointer items-start text-sm leading-6">
                  <Checkbox
                    checked={createTeamConsent}
                    onCheckedChange={(checked) => setCreateTeamConsent(checked === true)}
                    aria-label="Consent to create a team workspace"
                  />
                  <span>I approve creating this Pro team. A successful action creates the first server revision.</span>
                </Label>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void createTeam()}
                  disabled={signedOut || !createTeamConsent || teamName.trim().length < 2 || pendingAction !== null}
                >
                  {actionLabel(pendingAction, "create-team", "Creating team…") ?? (
                    <><Users data-icon="inline-start" aria-hidden="true" />Create Pro team</>
                  )}
                </Button>
              </div>
            ) : billing ? (
              <Alert>
                <Crown aria-hidden="true" />
                <AlertTitle>Pro is required to create teams</AlertTitle>
                <AlertDescription>Member builds and BYOK remain available. A verified active Pro subscription unlocks team creation and collaborators.</AlertDescription>
              </Alert>
            ) : null}

            {workspaces.length ? (
              <div className="space-y-2" aria-label="Available team workspaces">
                {workspaces.map((workspace) => {
                  const workspaceRole = accountIdentity ? currentRole(workspace, accountIdentity) : null
                  return (
                    <Button
                      key={workspace.id}
                      type="button"
                      variant={workspace.id === selectedWorkspace?.id ? "secondary" : "outline"}
                      className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal py-2 text-left"
                      aria-pressed={workspace.id === selectedWorkspace?.id}
                      onClick={() => {
                        setSelectedWorkspaceId(workspace.id)
                        setSelectedTeamProjectId("")
                        setApplyConsent(false)
                      }}
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{workspace.name}</strong>
                        <span className="block text-sm font-normal text-muted-foreground">Revision {workspace.revision}</span>
                      </span>
                      <Badge variant="outline">{workspaceRole ?? "Role unavailable"}</Badge>
                    </Button>
                  )
                })}
              </div>
            ) : loadState === "ready" && !teamMessage ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
                No owned or joined team workspace was returned for this signed account.
              </p>
            ) : null}

            {teamMessage ? (
              <Alert variant={teamMessageIsError ? "destructive" : "default"}>
                <AlertTitle>Team status</AlertTitle>
                <AlertDescription>{teamMessage}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="@4xl/account-team:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Invite, members &amp; revision</CardTitle>
            <CardDescription className="text-base leading-7">
              Capabilities are shown once, never stored by this client, and accepted only after explicit consent.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 @4xl/account-team:grid-cols-2">
            <div className="space-y-4">
              {selectedWorkspace ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedWorkspace.name}</Badge>
                    <Badge variant="outline">Your role: {role ?? "unverified"}</Badge>
                    <Badge variant="outline">Team revision {selectedWorkspace.revision}</Badge>
                    <Badge variant="outline">{selectedWorkspace.members.length} members</Badge>
                  </div>
                  {canManage ? (
                    <Label className="cursor-pointer items-start text-sm leading-6">
                      <Checkbox
                        checked={teamConsent}
                        onCheckedChange={(checked) => setTeamConsent(checked === true)}
                        aria-label="Consent to owner team mutations"
                      />
                      <span>I approve the next owner-only invite or role mutation. Each successful action consumes a new server revision.</span>
                    </Label>
                  ) : null}
                  <ul className="space-y-2" aria-label={`${selectedWorkspace.name} members and roles`}>
                    {selectedWorkspace.members.map((member) => (
                      <li key={member.identity} className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-mono" title={member.identity}>
                          {shortIdentity(member.identity)}{member.identity === accountIdentity ? " · You" : ""}
                        </span>
                        {canManage && member.role !== "owner" ? (
                          <div
                            className="flex flex-wrap gap-2"
                            role="group"
                            aria-label={`Change ${shortIdentity(member.identity)} role`}
                          >
                            {(["editor", "viewer"] as const).map((candidate) => (
                              <Button
                                key={candidate}
                                type="button"
                                size="sm"
                                variant={member.role === candidate ? "secondary" : "outline"}
                                aria-pressed={member.role === candidate}
                                disabled={
                                  signedOut
                                  || !teamConsent
                                  || pendingAction !== null
                                  || member.role === candidate
                                }
                                onClick={() => void updateMemberRole(member.identity, candidate)}
                              >
                                {pendingAction === "update-member-role"
                                  && pendingMemberIdentity === member.identity
                                  && member.role !== candidate ? (
                                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                                  ) : null}
                                {candidate === "editor" ? "Editor" : "Viewer"}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <Badge variant={member.role === "owner" ? "default" : "outline"}>{member.role}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canManage ? (
                    <div className="space-y-3 rounded-xl border border-border p-3">
                      <span className="text-sm font-medium">Create one-time collaborator invite</span>
                      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Invite role">
                        {(["editor", "viewer"] as const).map((candidate) => (
                          <Button
                            key={candidate}
                            type="button"
                            variant={inviteRole === candidate ? "secondary" : "outline"}
                            aria-pressed={inviteRole === candidate}
                            onClick={() => setInviteRole(candidate)}
                          >
                            {candidate === "editor" ? "Editor" : "Viewer"}
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => void createInvite()}
                        disabled={signedOut || !teamConsent || pendingAction !== null}
                      >
                        {actionLabel(pendingAction, "create-invite", "Creating invite…") ?? (
                          <><UserPlus data-icon="inline-start" aria-hidden="true" />Create 7-day invite</>
                        )}
                      </Button>
                      {!teamConsent ? (
                        <p className="text-sm leading-6 text-muted-foreground">Approve the owner mutation above before creating an invite.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      Only the verified team owner can create editor or viewer capabilities.
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Select or accept a team to inspect its ACL.</p>
              )}

              {oneTimeInvite ? (
                <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <LockKeyhole className="size-4" aria-hidden="true" />
                    One-time {oneTimeInvite.role} capability
                  </div>
                  <p className="text-sm leading-6">{oneTimeInvite.workspaceName} · expires {readableDate(oneTimeInvite.expiresAt)}</p>
                  <code className="block max-h-32 overflow-auto break-all rounded-lg bg-white p-3 text-sm leading-6">{oneTimeInvite.capability}</code>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={signedOut}
                      onClick={() => {
                        if (signedOut) return
                        if (!navigator.clipboard?.writeText) {
                          onToast("Clipboard access is unavailable — copy the visible capability manually")
                          return
                        }
                        void navigator.clipboard.writeText(oneTimeInvite.capability)
                          .then(() => onToast("One-time team capability copied"))
                          .catch(() => onToast("Could not copy the team capability"))
                      }}
                    >
                      <Copy data-icon="inline-start" aria-hidden="true" />Copy invite
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setOneTimeInvite(null)}>Hide capability</Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-border p-3">
                <Label htmlFor={inviteCapabilityId}>Paste a one-time team capability</Label>
                <Input
                  id={inviteCapabilityId}
                  type="password"
                  className="h-11! min-h-11! text-sm!"
                  value={inviteCapability}
                  onChange={(event) => setInviteCapability(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Capability is never persisted by this panel"
                />
                <Label className="cursor-pointer items-start text-sm leading-6">
                  <Checkbox
                    checked={acceptConsent}
                    onCheckedChange={(checked) => setAcceptConsent(checked === true)}
                    aria-label="Consent to accept team invite"
                  />
                  <span>I consent to join this team with the role encoded in the signed capability.</span>
                </Label>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void acceptInvite()}
                  disabled={signedOut || !acceptConsent || !inviteCapability.trim() || pendingAction !== null}
                >
                  {actionLabel(pendingAction, "accept-invite", "Accepting invite…") ?? (
                    <><Check data-icon="inline-start" aria-hidden="true" />Accept signed capability</>
                  )}
                </Button>
              </div>

              <Separator />

              <div className="space-y-3 rounded-xl border border-border p-3">
                <div>
                  <span className="text-sm font-medium">Share current project</span>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Sends a validated memberProjectDraft for “{project.spec.name}”. Canonical multi-file source is included. Provider keys, runtime receipts, terminal output, and compiled HTML are excluded.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Storage has a 3 MB private shared-source capacity per owner across all teams; replace or archive large shared revisions when the server reports that boundary.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Server project revision {sharedProject?.revision ?? 0}</Badge>
                  {optimisticRevision?.workspaceId === selectedWorkspace?.id ? (
                    <Badge variant="secondary">
                      Optimistic {optimisticRevision.workspaceRevision}/{optimisticRevision.projectRevision}
                    </Badge>
                  ) : null}
                </div>
                {selectedWorkspace?.projects.length ? (
                  <div className="space-y-2" aria-label="Verified shared project revisions">
                    {selectedWorkspace.projects.map((item) => (
                      <Button
                        key={item.projectId}
                        type="button"
                        variant={item.projectId === applicableProject?.projectId ? "secondary" : "outline"}
                        className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal py-2 text-left"
                        aria-pressed={item.projectId === applicableProject?.projectId}
                        onClick={() => {
                          setSelectedTeamProjectId(item.projectId)
                          setApplyConsent(false)
                        }}
                      >
                        <span className="min-w-0 truncate text-sm font-medium">{item.draft.spec.name}</span>
                        <Badge variant="outline">Source revision {item.revision}</Badge>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    This team has no verified shared source revision yet.
                  </p>
                )}
                <Label className="cursor-pointer items-start text-sm leading-6">
                  <Checkbox
                    checked={applyConsent}
                    onCheckedChange={(checked) => setApplyConsent(checked === true)}
                    aria-label="Consent to apply the verified shared source revision locally"
                  />
                  <span>Replace this local editor state with the selected verified source revision. Team state stays unchanged.</span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void applySharedProject()}
                  disabled={signedOut || !applicableProject || !applyConsent || pendingAction !== null}
                >
                  {actionLabel(pendingAction, "apply-project", "Opening shared source…") ?? (
                    <><Check data-icon="inline-start" aria-hidden="true" />Open shared source locally</>
                  )}
                </Button>
                <Label className="cursor-pointer items-start text-sm leading-6">
                  <Checkbox
                    checked={shareConsent}
                    onCheckedChange={(checked) => setShareConsent(checked === true)}
                    aria-label={`Consent to share ${project.spec.name} with the selected team`}
                  />
                  <span>I approve sharing this project draft and creating the next team/project revisions.</span>
                </Label>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void shareProject()}
                  disabled={signedOut || !selectedWorkspace || !canWrite || !shareConsent || pendingAction !== null}
                >
                  {actionLabel(pendingAction, "share-project", "Saving revision…") ?? (
                    <><Users data-icon="inline-start" aria-hidden="true" />Share project revision</>
                  )}
                </Button>
                {!selectedWorkspace ? (
                  <p className="text-sm text-muted-foreground">Select or accept a team before sharing.</p>
                ) : role === "viewer" ? (
                  <p className="text-sm text-muted-foreground">Viewer access is read-only; an owner or editor can share revisions.</p>
                ) : role === null ? (
                  <p className="text-sm text-muted-foreground">Write access is not verified for this signed account.</p>
                ) : null}
                {shareMessage ? (
                  <Alert variant={shareMessage.includes("failed") || shareMessage.includes("conflict") ? "destructive" : "default"}>
                    <AlertTitle>Project revision</AlertTitle>
                    <AlertDescription>{shareMessage}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
