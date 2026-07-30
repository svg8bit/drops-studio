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

const { createFreeElementDirectorProposal } = await import(
  "../lib/project-director.ts"
);
const { createProjectSpec } = await import("../lib/project-factory.ts");

function createBaseSpec() {
  return createProjectSpec({
    presetId: "crypto-game",
    values: { game: "Unlock Dodge" },
    prompt: "Sequential Director scaling proof",
    tools: ["DropsTab market data", "Drops Bot action handoff"],
    provider: "free",
    model: "Free Auto",
    market: [],
    prediction: { title: "No prediction selected", probability: null, change: null },
    origin: "http://127.0.0.1:4173",
  });
}

test("sequential Director scaling starts from the effective element override", () => {
  const element = {
    id: "hero-title",
    label: "Hero title",
    tag: "h1",
    text: "Catch the market before it moves",
    textEditable: true,
    styles: { fontSize: 40 },
  };
  const first = createFreeElementDirectorProposal(
    createBaseSpec(),
    "Make it bigger",
    element,
  );

  assert.equal(first.spec.elements?.[element.id]?.fontSize, 47);

  const second = createFreeElementDirectorProposal(
    first.spec,
    "Make it bigger",
    {
      ...element,
      overrides: first.spec.elements?.[element.id],
    },
  );

  assert.equal(second.spec.elements?.[element.id]?.fontSize, 55);
});

test("sequential Director movement starts from the effective element override", () => {
  const element = {
    id: "hero-title",
    label: "Hero title",
    tag: "h1",
    text: "Catch the market before it moves",
    textEditable: true,
    styles: { translateX: 0, translateY: 0 },
  };
  const first = createFreeElementDirectorProposal(
    createBaseSpec(),
    "Move right",
    element,
  );

  assert.equal(first.spec.elements?.[element.id]?.translateX, 24);

  const second = createFreeElementDirectorProposal(
    first.spec,
    "Move right",
    {
      ...element,
      overrides: first.spec.elements?.[element.id],
    },
  );

  assert.equal(second.spec.elements?.[element.id]?.translateX, 48);
});
