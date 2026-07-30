import { mkdir } from "node:fs/promises"
import path from "node:path"

import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"

const RELEASE_PROOF_DIR = path.join(process.cwd(), "outputs/proofs/release")

test("captures fresh home and Studio evidence at every release viewport", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  await mkdir(RELEASE_PROOF_DIR, { recursive: true })

  await prepareHomePage(page)
  await expect(page.getByRole("button", { name: "Build now" })).toBeVisible()
  // The preview swaps from its deterministic fallback to the compiled product
  // during hydration. Assert the stable content instead of holding a locator to
  // the replaceable wrapper, which can detach under a parallel browser run.
  // Re-querying inside the page also activates the below-fold mobile preview.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const columns = document.querySelectorAll<HTMLElement>(".preview-column")
        const previewColumn = columns.item(columns.length - 1)
        previewColumn?.scrollIntoView({ block: "center", behavior: "auto" })
        return Boolean(previewColumn)
      })
    )
    .toBe(true)
  await expect(
    page.locator(".preview-device").getByText("Morning Alpha", { exact: true }).first()
  ).toBeVisible()
  await expect(
    page.getByText("Preparing category-native preview", { exact: true })
  ).toHaveCount(0)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }))
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: path.join(RELEASE_PROOF_DIR, `home-${testInfo.project.name}.png`),
  })

  await prepareStudioPage(page)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: path.join(RELEASE_PROOF_DIR, `studio-${testInfo.project.name}.png`),
  })

  await assertCleanRuntime()
})
