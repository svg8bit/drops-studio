import type { Page } from "@playwright/test";

import { compileProject } from "../../lib/project-compiler";
import { createProjectSpec } from "../../lib/project-factory";
import { materializeProjectV2Template } from "../../lib/project-template-materializer";
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProject,
} from "../../lib/project-types";
import type { ProjectV2 } from "../../lib/project-v2-types";
import { expect } from "./ui-test";

const CREATED_AT = "2026-07-30T12:00:00.000Z";

export interface ProjectV2UiFixtureOptions {
  persistedPreview?: boolean;
}

export async function prepareProjectV2UiPage(
  page: Page,
  options: ProjectV2UiFixtureOptions = {},
): Promise<{ project: GeneratedProject; projectV2: ProjectV2 }> {
  const id = options.persistedPreview
    ? "v2-persisted-preview-contract"
    : "v2-integrated-workspace-contract";
  const spec = createProjectSpec({
    presetId: "smart-money-copy",
    values: { wallets: "0x1111…1111" },
    prompt: "Whale intelligence Project V2 integration contract",
    tools: ["DropsTab market data", "Drops Bot wallet monitoring"],
    provider: "free",
    model: "Free Auto",
    market: [
      {
        symbol: "BTC",
        name: "Bitcoin",
        price: "$118,420",
        change: 2.4,
        marketCap: "$2.36T",
      },
    ],
    prediction: {
      title: "Bitcoin above $120k this month",
      probability: 64,
      change: 3,
    },
    origin: "http://127.0.0.1:4173",
  });
  let projectV2 = await materializeProjectV2Template({ id, spec, now: CREATED_AT });
  if (options.persistedPreview) {
    projectV2 = {
      ...projectV2,
      preview: {
        status: "ready",
        projectRevision: projectV2.revision,
        sandboxId: "persisted-unverified-sandbox",
        url: "https://persisted-preview.invalid/",
        port: 3000,
        startedAt: CREATED_AT,
      },
    };
  }
  const project: GeneratedProject = {
    id,
    spec,
    html: compileProject(spec),
    projectV2,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };

  await page.route("**/api/projects/v2**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PROJECT_V2_STORAGE_UNAVAILABLE",
        error: "Private Project V2 storage is not configured. The browser project remains available.",
      }),
    });
  });
  await page.route("**/api/builder/runtime", async (route) => {
    const input = route.request().postDataJSON() as { action?: string };
    if (input.action !== "status") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Only status is available in this UI contract." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        action: "status",
        result: {
          provider: "vercel-sandbox",
          status: "unavailable",
          sandboxName: null,
          sessionId: null,
          vcpus: null,
          memoryMb: null,
          createdAt: null,
          updatedAt: CREATED_AT,
          expiresAt: null,
          activeDurationMs: 0,
          previewUrl: null,
          previewCommandId: null,
        },
      }),
    });
  });
  await page.route("**/api/integrations/github", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "github",
          configured: false,
          mode: "session-token-required",
          permissions: ["contents:write", "pull_requests:write", "metadata:read"],
          sessionTokenSupported: true,
          explicitApprovalRequired: ["branch", "commit", "pull-request"],
        }),
      });
      return;
    }
    const input = route.request().postDataJSON() as { action?: string };
    if (input.action === "inspect") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          repository: {
            owner: "drops",
            repo: "whale-app",
            defaultBranch: "main",
            private: true,
            url: "https://github.com/drops/whale-app",
          },
        }),
      });
      return;
    }
    if (input.action === "import") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          repository: {
            owner: "drops",
            repo: "whale-app",
            defaultBranch: "main",
            private: true,
            url: "https://github.com/drops/whale-app",
          },
          files: [{ path: "README.md", content: "# Imported from GitHub\n" }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Publish is not available without a verified release gate." }),
    });
  });

  await page.addInitScript(
    ({ key, value, autoBuildKey }) => {
      if (window.top !== window) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem(autoBuildKey, "1");
    },
    {
      key: PROJECTS_STORAGE_KEY,
      value: JSON.stringify([project]),
      autoBuildKey: `drops-studio:v2-auto-build:${id}:${projectV2.revision}`,
    },
  );
  await page.goto(`/studio/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/);
  await page.locator(".studio-rail").getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByTestId("project-v2-workspace")).toBeVisible();
  return { project, projectV2 };
}
