import { expect, prepareHomePage, test } from "../fixtures/ui-test"

test("signed-in member allowance and OpenRouter session state stay coherent in the UI", async ({
  page,
}) => {
  let signedIn = true
  await page.route("**/api/access", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access: signedIn
          ? {
              tier: "member",
              authenticated: true,
              platformAi: { available: true, limit: 10, remaining: 8, reset: "daily-utc" },
              account: { available: true, connected: true, provider: "openrouter", projectSync: false },
            }
          : {
              tier: "guest",
              authenticated: false,
              platformAi: { available: true, limit: 3, remaining: 3, reset: "daily-utc" },
              account: { available: true, connected: false, provider: "openrouter", projectSync: false },
            },
      }),
    })
  })
  await page.route("**/api/auth/session", async (route) => {
    expect(route.request().method()).toBe("DELETE")
    signedIn = false
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ disconnected: true }),
    })
  })

  await prepareHomePage(page)
  await expect(page.getByText("8 signed-in AI builds left today", { exact: true })).toBeVisible()

  const desktopConnections = page.locator(".api-vault-button")
  if (await desktopConnections.isVisible()) {
    await desktopConnections.click()
  } else {
    await page.getByRole("button", { name: "Toggle menu" }).click()
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Connections", exact: true }).click()
  }
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Connections Hub", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: /^OpenRouter/ }).click()
  await expect(dialog.getByText("Studio member session connected", { exact: true })).toBeVisible()
  await expect(dialog.getByText(/key still stays only in this browser tab/i)).toBeVisible()

  await dialog.getByRole("button", { name: /Disconnect account/i }).click()
  await dialog.getByRole("button", { name: "Close connections" }).click()
  await expect(page.getByText("3 guest AI builds left today", { exact: true })).toBeVisible()
})
