import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const wildcardParentPostMessage =
  /window\.parent\.postMessage\(.*?,\s*["']\*["']\s*\)/s;

test("Next production build emits the complete Drops Studio builder HTML", async () => {
  const html = await readFile(
    new URL("../.next/server/app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>Drops Studio/);
  assert.match(html, /Build crypto apps 10x faster with AI/);
  assert.match(html, /AI Morning Alpha/);
  assert.match(html, /Action Engine/);
  assert.match(html, /Crypto Aggregator/);
  assert.match(html, /Portfolio Tamagotchi/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("starter preview is removed and source contains the required product surfaces", async () => {
  const [page, component, setup, dropstabRoute, dropstabClient, agentRoute, compiler, packageJson, studio, telegramAccount, telegramWizard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio-setup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dropstab/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dropstab-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/telegram-account.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/telegram-channel-wizard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<DropsStudio hero=\{<LandingHero \/>\} \/>/);
  assert.match(component, /providerList/);
  assert.match(component, /Connections Hub/);
  assert.match(component, /\/api\/agent\/plan/);
  assert.match(component, /OpenRouter/);
  assert.match(agentRoute, /openai\/gpt-5\.6-sol/);
  assert.match(agentRoute, /google\/gemini-3\.6-flash/);
  assert.match(agentRoute, /inclusionai\/ling-3\.0-flash-free/);
  assert.doesNotMatch(agentRoute, /poolside\/laguna-s-2\.1-free/);
  assert.doesNotMatch(agentRoute, /zai\/glm-4\.6v-flash/);
  assert.match(agentRoute, /GUEST_DAILY_LIMIT/);
  assert.match(compiler, /renderAlphaNative/);
  assert.match(compiler, /renderGameNative/);
  assert.match(compiler, /dropsbotSetup/);
  assert.match(compiler, /market-catcher-retro\.png/);
  assert.match(compiler, /market-wolf-catcher\.png/);
  assert.match(compiler, /drops-studio-element-selected/);
  assert.match(compiler, /drops-studio-element-inline-edit/);
  assert.match(compiler, /data-studio-element/);
  assert.match(compiler, /trustedParentMessage/);
  assert.match(compiler, /postParent/);
  assert.match(compiler, /ancestorOrigins/);
  assert.doesNotMatch(compiler, wildcardParentPostMessage);
  assert.match(compiler, /originalText/);
  assert.match(compiler, /editableOwnerKey/);
  assert.match(component, /sessionStorage/);
  assert.match(component, /DropsStudioSetup/);
  assert.match(setup, /Start from a blank canvas/);
  assert.match(component, /readProjectsFromStore/);
  assert.match(component, /saveProjectSafely/);
  assert.match(component, /item\.id !== "dropsbot"/);
  assert.doesNotMatch(component, /marker === "account-connected"/);
  assert.doesNotMatch(component, /drops-studio:dropsbot.*account-connected/);
  assert.match(telegramWizard, /Drops Studio bot/);
  assert.match(telegramWizard, /My BotFather bot/);
  assert.match(telegramWizard, /\/use_thread/);
  assert.doesNotMatch(telegramWizard, /ColdMathAI_bot/);
  assert.doesNotMatch(component, /telegram-setup-started/);
  assert.equal(
    component.match(/Array\.isArray\(payload\.coins\)/g)?.length,
    2,
  );
  assert.match(component, /router\.push\(`\/studio\//);
  assert.match(studio, /Publish free now/);
  assert.match(studio, /Download runnable app \+ source/);
  assert.match(studio, /Replace this image/);
  assert.match(studio, /Save version/);
  assert.match(studio, /Export & continue/);
  assert.match(telegramAccount, /claimTelegramChannelRequest/);
  assert.match(telegramAccount, /channels\.DeleteChannel/);
  assert.match(telegramAccount, /TELEGRAM_AUTH_DEADLINE_MS/);
  assert.match(telegramAccount, /Omit<TelegramChannelResult, "accountToken">/);
  assert.match(telegramAccount, /expiresAt: createdAt \+ ACCOUNT_TTL_MS/);
  assert.match(telegramAccount, /accountToken: seal\(refreshedAccount\)/);
  assert.match(telegramWizard, /creationRequestId/);
  assert.match(dropstabRoute, /fetchDropsTabIntelligence\(key/);
  assert.match(dropstabClient, /"x-dropstab-api-key": (?:key|apiKey)/);
  assert.match(packageJson, /"name": "drops-studio"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("wildcard parent postMessage guard detects multiline calls", () => {
  assert.match(`window.parent.postMessage(
    { type: "unsafe" },
    "*"
  )`, wildcardParentPostMessage);
});
