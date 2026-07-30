import AxeBuilder from "@axe-core/playwright";

import { PROJECTS_STORAGE_KEY } from "../../lib/project-types";

import {
  expect,
  expectNoHorizontalOverflow,
  test,
} from "../fixtures/ui-test";
import { prepareProjectV2UiPage } from "../fixtures/project-v2-ui-test";

test("Project V2 keeps drafts, saves locally, exposes Data and Logic, and reaches honest GitHub controls", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const { project } = await prepareProjectV2UiPage(page);
  const workspace = page.getByTestId("project-v2-workspace");

  await expect(page.getByText("Browser-local editing is active.", { exact: false })).toBeVisible();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("// PRESERVED-DRAFT\nexport default function Page() { return null }", { delay: 1 });
  await expect(workspace.getByText("Unsaved changes", { exact: true })).toBeVisible();

  await page.locator('button[title="app/layout.tsx"]').click();
  await page.locator('button[title="app/page.tsx"]').click();
  await expect(page.locator(".cm-content")).toContainText("PRESERVED-DRAFT");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(workspace.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(({ key, id }) => {
    const projects = JSON.parse(window.localStorage.getItem(key) || "[]") as Array<{
      id: string;
      projectV2?: { files?: Record<string, { content?: string }> };
    }>;
    return projects.find((candidate) => candidate.id === id)?.projectV2?.files?.["app/page.tsx"]?.content ?? "";
  }, { key: PROJECTS_STORAGE_KEY, id: project.id })).toContain("PRESERVED-DRAFT");

  await workspace.getByRole("button", { name: "Data", exact: true }).click();
  await expect(workspace.getByText("Declared namespace and capability only", { exact: true })).toBeVisible();
  await expect(workspace.getByText(project.id, { exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "Logic", exact: true }).click();
  await expect(workspace.getByText("Executable manifest declarations", { exact: true })).toBeVisible();
  await expect(workspace.getByText("npm run typecheck", { exact: true })).toBeVisible();

  await workspace.getByRole("button", { name: "Deploy", exact: true }).click();
  await expect(workspace.getByText("Session token required", { exact: true })).toBeVisible();
  await workspace.getByLabel("Session-only GitHub access token").fill("test-session-github-token-1234567890");
  await workspace.getByRole("button", { name: "Use for session", exact: true }).click();
  await workspace.getByLabel("GitHub repository owner").fill("drops");
  await workspace.getByLabel("GitHub repository name").fill("whale-app");
  await workspace.getByRole("button", { name: "Inspect repository", exact: true }).click();
  await expect(workspace.getByText("drops/whale-app", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Open pull request", exact: true })).toBeDisabled();

  page.once("dialog", (dialog) => dialog.accept());
  await workspace.getByRole("button", { name: "Import files", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "Files", exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator('button[title="README.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Imported from GitHub");

  await expectNoHorizontalOverflow(page);
  if ((page.viewportSize()?.width ?? 0) > 720) {
    const geometry = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>(".project-v2-studio-host");
      const footer = document.querySelector<HTMLElement>('[class*="_editorFooter"]');
      if (!host || !footer) return null;
      return {
        hostBottom: host.getBoundingClientRect().bottom,
        footerBottom: footer.getBoundingClientRect().bottom,
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.footerBottom).toBeLessThanOrEqual(geometry!.hostBottom + 1);
  }
  expect(pageErrors).toEqual([]);
});

test("persisted preview stays unavailable until the Sandbox provider confirms it", async ({ page }) => {
  const runtimeStatusRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/builder/runtime") && request.postData()?.includes('"action":"status"')) {
      runtimeStatusRequests.push(request.url());
    }
  });
  await prepareProjectV2UiPage(page, { persistedPreview: true });
  const workspace = page.getByTestId("project-v2-workspace");
  await expect(workspace.getByText("Live preview unavailable", { exact: true })).toBeVisible();
  await expect(workspace.locator('iframe[title$="Sandbox preview"]')).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "Stop sandbox", exact: true })).toBeDisabled();
  await expect.poll(() => runtimeStatusRequests.length).toBeGreaterThan(0);
  await expect(workspace.locator('[class*="_sandboxStrip"]')).not.toContainText("Running");
  await expectNoHorizontalOverflow(page);
});

test("Project V2 Files surface passes WCAG A/AA Axe checks", async ({ page }) => {
  await prepareProjectV2UiPage(page);
  await expect(page.locator(".cm-content")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".project-v2-studio-host")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target),
  }))).toEqual([]);
});
