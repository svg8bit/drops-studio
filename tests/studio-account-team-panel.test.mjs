import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/studio-account-team-panel.tsx", import.meta.url),
  "utf8",
);
const studioSource = await readFile(
  new URL("../components/project-studio.tsx", import.meta.url),
  "utf8",
);

test("account and team panel uses the signed ACL plus stable billing/team routes", () => {
  assert.match(source, /fetch\("\/api\/billing\/status"/);
  assert.match(source, /fetch\(`\/api\/billing\/\$\{destination\}`/);
  assert.match(source, /fetch\("\/api\/teams"/);
  assert.match(source, /\/api\/teams\/\$\{encodeURIComponent\(selectedWorkspace\.id\)\}\/invites/);
  assert.match(source, /\/api\/teams\/\$\{encodeURIComponent\(selectedWorkspace\.id\)\}\/members/);
  assert.match(source, /fetch\("\/api\/teams\/invites\/accept"/);
  assert.match(source, /\/api\/teams\/\$\{encodeURIComponent\(selectedWorkspace\.id\)\}\/projects/);

  assert.match(source, /setAccountIdentity\(typeof teamsPayload\.accountIdentity/);
  assert.match(source, /workspace\.members\.find\(\(member\) => member\.identity === accountIdentity\)/);
  assert.match(source, /role === "owner" \|\| role === "editor"/);
  assert.match(source, /role === "viewer"/);
  assert.match(source, /payload\.code === "PRO_REQUIRED"/);
});

test("mutations require explicit consent and preserve optimistic revision conflicts", () => {
  assert.match(source, /JSON\.stringify\(\{ consent: true \}\)/);
  assert.match(source, /JSON\.stringify\(\{ name: teamName, consent: true \}\)/);
  assert.match(source, /ownerIdentity: selectedWorkspace\.ownerIdentity[\s\S]*expectedRevision: selectedWorkspace\.revision[\s\S]*expiresInHours: 168[\s\S]*consent: true/);
  assert.match(source, /JSON\.stringify\(\{ capability: inviteCapability\.trim\(\), consent: true \}\)/);
  assert.match(source, /expectedWorkspaceRevision: selectedWorkspace\.revision/);
  assert.match(source, /expectedProjectRevision: sharedProject\?\.revision \?\? 0/);
  assert.match(source, /project: memberProjectDraft\(project\)/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /memberIdentity,[\s\S]*role: nextRole,[\s\S]*expectedRevision: selectedWorkspace\.revision,[\s\S]*consent: true/);
  assert.match(source, /pendingAction\("update-member-role"\)|setPendingAction\("update-member-role"\)/);
  assert.match(source, /workspaceRevision: selectedWorkspace\.revision \+ 1/);
  assert.match(source, /projectRevision: \(sharedProject\?\.revision \?\? 0\) \+ 1/);
  assert.match(source, /response\.status === 409 && payload\.current/);
  assert.match(source, /No local overwrite occurred/);
  assert.match(source, /Role was not changed: the team changed elsewhere/);
  assert.match(source, /replaceWorkspace\(payload\.current\)/);

  assert.match(source, /One-time .* capability/);
  assert.match(source, /capability is held only in this open panel and is not persisted/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);

  const createInvite = source.slice(
    source.indexOf("async function createInvite"),
    source.indexOf("async function acceptInvite"),
  );
  const beforeVerifiedReceipt = createInvite.slice(
    0,
    createInvite.indexOf("replaceWorkspace(payload.workspace)"),
  );
  assert.doesNotMatch(beforeVerifiedReceipt, /setOneTimeInvite\(null\)/);
  assert.match(createInvite, /replaceWorkspace\(payload\.workspace\)[\s\S]*setOneTimeInvite\(\{/);
});

test("panel keeps access claims honest and follows the local Tailwind/Base UI floor", () => {
  assert.match(source, /BYOK · 0% Studio markup/);
  assert.match(source, /Provider billing stays with you; keys are request-only\/session-only/);
  assert.match(source, /Current billing tier is not verified while the status service is unavailable/);
  assert.match(source, /Signed Studio account required/);
  assert.match(source, /Canonical multi-file source is included/);
  assert.match(source, /Provider keys, runtime receipts, terminal output, and compiled HTML are excluded/);
  assert.match(source, /3 MB private shared-source capacity per owner/);

  assert.match(source, /import "@\/app\/styles\/tailwind\.css"/);
  assert.match(source, /from "@\/components\/ui\/button"/);
  assert.match(source, /from "@\/components\/ui\/checkbox"/);
  assert.match(source, /from "lucide-react"/);
  assert.doesNotMatch(source, /<button\b|<input\b/);
  assert.doesNotMatch(source, /style=\{|\.module\.css|studio-account-team-panel\.css/);
  assert.doesNotMatch(source, /text-\[(?:[0-9]|1[01])px\]/);
  assert.doesNotMatch(source, /\btext-\[0\.[0-6](?:rem)?\]/);
  assert.match(source, /text-base/);
  assert.match(source, /text-sm/);
  assert.match(source, /min-h-11/);
  assert.match(source, /aria-label="Refresh account and team status"/);
  assert.match(source, /aria-label="Consent to open Stripe billing"/);
  assert.match(source, /aria-label="Consent to accept team invite"/);
  assert.match(source, /aria-label="Consent to apply the verified shared source revision locally"/);
  assert.match(source, /accessUnverified \|\| !acceptConsent/);
  assert.match(source, /accessUnverified \|\| !selectedWorkspace \|\| !canWrite/);
  assert.match(source, /accessUnverified \|\| !teamConsent/);
  assert.match(source, /accessUnverified \|\| !createTeamConsent/);
  assert.match(source, /type LoadState = "loading" \| "ready" \| "signed-out" \| "unavailable"/);
  assert.match(source, /setLoadState\("unavailable"\)/);
  assert.match(source, /aria-label="Consent to create a team workspace"/);
  assert.match(source, /aria-label="Consent to owner team mutations"/);
  assert.match(source, /checked=\{teamConsent\}[\s\S]*I approve the next owner-only invite or role mutation/);
  assert.ok(
    source.indexOf('aria-label="Consent to owner team mutations"')
      > source.indexOf("{selectedWorkspace ? ("),
    "owner mutation consent must live with workspace management, not only billing-gated team creation",
  );
  assert.equal(source.match(/className="h-11! min-h-11! text-sm!"/g)?.length, 2);
});

test("owners, editors and viewers can apply a verified shared source revision locally", () => {
  assert.match(source, /onApplyProject: \(project: GeneratedProject\) => boolean \| Promise<boolean>/);
  assert.match(source, /materializeMemberProject/);
  assert.match(source, /async function applySharedProject\(\)/);
  assert.match(source, /schemaVersion: 1,[\s\S]*\.\.\.applicableProject\.draft,[\s\S]*revision: applicableProject\.revision/);
  assert.match(source, /onApplyProject\(materialized\)/);
  assert.match(source, /const applied = await onApplyProject\(materialized\)/);
  assert.match(source, /if \(!applied\)/);
  assert.match(source, /disabled=\{accessUnverified \|\| !applicableProject \|\| !applyConsent \|\| pendingAction !== null\}/);
  assert.doesNotMatch(
    source.slice(source.indexOf("async function applySharedProject"), source.indexOf("async function shareProject")),
    /canWrite|role === "owner"|role === "editor"/,
  );
});

test("team apply replaces same-id state but safely persists and navigates for a different shared id", () => {
  assert.match(studioSource, /async function applyTeamProject\(\s*sharedProject: GeneratedProject/);
  assert.match(studioSource, /sourceEditedAt: appliedAt/);
  assert.match(studioSource, /updatedAt: appliedAt/);
  assert.match(studioSource, /const saved = await saveProjectSafely\(localProject/);
  assert.match(studioSource, /if \(localProject\.id === params\.id\) \{[\s\S]*adoptProject\(localProject\)[\s\S]*return true/);
  assert.doesNotMatch(studioSource, /replaceProject\(localProject\)/);
  assert.match(studioSource, /readProjectsFromStore\(\)\.find\(\s*\(item\) => item\.id === localProject\.id/);
  assert.match(studioSource, /saveProjectSafely\(localProject, \{[\s\S]*expectedUpdatedAt: existing\?\.updatedAt \?\? null/);
  assert.match(studioSource, /window\.location\.assign\(\s*`\/studio\/\$\{encodeURIComponent\(localProject\.id\)\}`/);
  assert.match(studioSource, /<StudioAccountTeamPanel[\s\S]*onApplyProject=\{applyTeamProject\}/);
  assert.doesNotMatch(studioSource, /if \(next\.sourceEditedAt\) \{[\s\S]*setProjectSyncStatus\("local"\)/);
});

test("signed-out and action-level 401 clear capabilities and consent before reuse", () => {
  assert.match(source, /const clearSensitiveState = useCallback\(\(\) => \{/);
  for (const reset of [
    "setBillingConsent(false)",
    'setTeamName("")',
    "setCreateTeamConsent(false)",
    "setTeamConsent(false)",
    "setOneTimeInvite(null)",
    'setInviteCapability("")',
    "setAcceptConsent(false)",
    "setApplyConsent(false)",
    'setSelectedTeamProjectId("")',
    "setShareConsent(false)",
    'setShareMessage("")',
    "setOptimisticRevision(null)",
  ]) {
    assert.match(source, new RegExp(reset.replace(/[()]/g, "\\$&")));
  }
  assert.match(source, /if \(billingResponse\.status === 401 \|\| teamsResponse\.status === 401\) \{[\s\S]*markSignedOut\(\)/);
  assert.ok(
    (source.match(/handleUnauthorizedResponse\(response\)/g) ?? []).length >= 6,
    "every billing/team mutation must handle an expired signed session",
  );
  assert.match(source, /disabled=\{accessUnverified\}[\s\S]*if \(accessUnverified\) return[\s\S]*navigator\.clipboard\?\.writeText[\s\S]*navigator\.clipboard\.writeText\(oneTimeInvite\.capability\)/);
  assert.match(source, /Clipboard access is unavailable — copy the visible capability manually/);
});

test("billing action errors stay visible while verified billing remains loaded", () => {
  assert.match(source, /setBillingMessage\(message\)[\s\S]*onToast\(message\)/);
  const loadedBranchStart = source.indexOf(') : billing ? (');
  const actionAlert = source.indexOf("<AlertTitle>Billing action failed</AlertTitle>");
  const unavailableAlert = source.indexOf("<AlertTitle>Billing status not verified</AlertTitle>");
  assert.ok(loadedBranchStart >= 0 && actionAlert > loadedBranchStart);
  assert.ok(unavailableAlert > actionAlert, "action error must render before the unavailable-status fallback branch");
  assert.match(
    source.slice(actionAlert - 160, actionAlert + 120),
    /billingMessage \? \([\s\S]*<Alert variant="destructive">[\s\S]*Billing action failed/,
  );
});
