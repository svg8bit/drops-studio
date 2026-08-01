import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseStudioConnectionHandoff } from "../lib/studio-connection-handoff.ts";

test("connection handoff preserves Drops Bot, Telegram flow and project context", () => {
  assert.deepEqual(
    parseStudioConnectionHandoff(
      "?connections=1&provider=dropsbot&flow=telegram-channel&project=alpha-channel-proof",
    ),
    {
      connections: true,
      provider: "dropsbot",
      flow: "telegram-channel",
      project: "alpha-channel-proof",
    },
  );
  assert.deepEqual(parseStudioConnectionHandoff("?connections=0"), {
    connections: false,
    provider: null,
    flow: null,
    project: null,
  });
});

test("layout and builder keep deterministic release safeguards", async () => {
  const [layout, builder, studio] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/project-studio.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(layout.match(/display: "swap"/g)?.length, 1);
  assert.equal(layout.match(/display: "optional"/g)?.length, 1);
  assert.match(layout, /\^https\?:\\\/\\\//);
  assert.ok(
    layout.includes('configuredProductionUrl.replace(/^\\/+/, "")'),
  );

  assert.match(builder, /parseStudioConnectionHandoff\(window\.location\.search\)/);
  assert.match(builder, /handoff\.provider === "dropsbot"/);
  assert.match(builder, /handoff\.flow === "telegram-channel"/);
  assert.match(builder, /setTelegramProjectSlug\(handoff\.project\)/);
  assert.match(builder, /let savedProjects: GeneratedProject\[\] = \[\]/);
  assert.match(builder, /savedProjects = await readProjectsAfterScopeBootstrap\(async \(\) =>/);
  const accessIndex = builder.indexOf('fetch("/api/access"');
  const scopedReadIndex = builder.indexOf("readProjectsAfterScopeBootstrap");
  assert.notEqual(accessIndex, -1, "actor bootstrap request must remain present");
  assert.notEqual(scopedReadIndex, -1, "scoped project bootstrap helper must remain present");
  assert.match(
    builder,
    /const stored = await saveProjectSafely\(project, \{[\s\S]+?expectedUpdatedAt: null,[\s\S]+?stored\.status === "conflict"[\s\S]+?next = stored\.projects/,
  );
  assert.doesNotMatch(builder, /let next = \[project, \.\.\.projects\]/);

  assert.match(studio, /await readProjectsAfterScopeBootstrap\(async \(\) =>/);
  assert.match(studio, /url\.hostname\.endsWith\("\.vercel\.run"\)/);
  assert.match(studio, /!url\.port/);
  assert.match(studio, /await reader\.cancel\(\)\.catch/);
  assert.match(studio, /conversation\.filter\(\(item\) => item\.id !== assistantId\)/);
  assert.match(studio, /const cloud = await listMemberProjectsFromCloud\(\)/);
  assert.match(
    studio,
    /const record = cloud\.projects\.find\(\(item\) => item\.id === params\.id\)/,
  );
  assert.match(
    studio,
    /Date\.parse\(record\.updatedAt\) > Date\.parse\(found\.updatedAt\)/,
  );
  assert.match(
    studio,
    /const materialized = await materializeMemberProject\(record\)[\s\S]+?expectedUpdatedAt: found\?\.updatedAt \?\? null,[\s\S]+?stored\.status === "saved"\) found = materialized/,
  );
});

test("preview runtime implements truthful data, stable timer and keyboard input", async () => {
  const [canvas, variants] = await Promise.all([
    readFile(new URL("../components/preview-canvas.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/preview-canvas-variants.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(canvas, /dataMode=\{dataMode\}/);
  assert.match(variants, /const localRoundSeconds =/);
  assert.match(variants, /useState\(\(\) => localRoundSeconds\)/);
  assert.match(variants, /setSeconds\(localRoundSeconds\)/);
  assert.match(variants, /const marketRef = useRef\(market\)/);
  assert.match(variants, /marketRef\.current\[0\]\?\.change/);
  assert.match(variants, /\}, \[playing\]\);/);
  assert.match(variants, /addEventListener\("keydown", handleKeyDown\)/);
  assert.match(variants, /removeEventListener\("keydown", handleKeyDown\)/);
  assert.match(variants, /event\.key === "ArrowLeft" \? -1 : 1/);
  assert.match(variants, /dataMode === "live"/);
  assert.match(variants, /live DropsTab context/);
});

test("explicit preview and Project Studio touch floors are at least 44px", async () => {
  const [previews, responsive, accessibility] = await Promise.all([
    readFile(
      new URL("../app/styles/drops-studio.previews.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/styles/project-studio.responsive.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/styles/project-studio.accessibility.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(previews, /\.preview-reactions button[^}]+height: 44px[^}]+width: 44px/);
  assert.match(previews, /\.preview-action[^}]+min-height: 44px/);
  for (const selector of [
    ".game-lock",
    ".brief-block button",
    ".catcher-result button",
    ".discovery-card button",
    ".siri-suggestions button",
    ".mic-button",
    ".radio-now button",
    ".catcher-controls button",
  ]) {
    assert.match(previews, new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]+?min-height: 44px`));
  }
  assert.match(previews, /\.studio-footer a \{[^}]+min-height: 44px;[^}]+min-width: 44px/);
  assert.match(
    previews,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]+?\.falling-token \{\s*animation: none !important;/,
  );
  assert.match(responsive, /\.workspace-actions button \{[^}]+min-height: 44px/);
  assert.match(responsive, /\.workspace-actions button \{[^}]+min-width: 44px/);
  assert.match(responsive, /\.stage-toolbar button \{[^}]+min-width: 44px/);
  assert.match(accessibility, /\.project-studio-shell :is\([\s\S]+?min-height: 44px;\s+min-width: 44px/);
});
