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
const { prepareEditableRuntimeHtml, validateEditableRuntimeHtml } = await import(
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

test("source workspace blocks secrets, evaluators, loopback dependencies and removed contracts", () => {
  const { spec, html } = project();
  const unsafe = html
    .replace(`data-project-kind="${spec.presetId}"`, "")
    .replace("</body>", '<script>eval("1")</script><a href="http://localhost:3000">local</a><p>sk-proj-abcdefghijklmnopqrstuvwxyz1234567890</p></body>');
  const result = validateEditableRuntimeHtml(spec, unsafe);
  assert.equal(result.valid, false);
  assert.match(result.issues.join(" "), /product-kind|eval|loopback|secret/i);
});
