import type { Locator, Page } from "@playwright/test"

import {
  expect,
  installRuntimeGuards,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"

async function expectFocusInside(page: Page, dialog: Locator) {
  await expect
    .poll(async () =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true)
}

async function verifyKeyboardDialog(
  page: Page,
  trigger: Locator,
  title: RegExp,
) {
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await trigger.press("Enter")

  const dialog = page.getByRole("dialog", { name: title })
  await expect(dialog).toBeVisible()
  await expectFocusInside(page, dialog)

  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press(step % 3 === 0 ? "Shift+Tab" : "Tab")
    await expectFocusInside(page, dialog)
  }

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
}

test("publish dialog traps focus, closes on Escape and restores its trigger", async ({
  page,
}) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  await prepareStudioPage(page)

  const publishTrigger = page.locator(".workspace-actions .publish-top")
  await verifyKeyboardDialog(page, publishTrigger, /Publish a working product/i)

  await assertCleanRuntime()
})
