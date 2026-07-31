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
  await page.route("**/api/account", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        signedIn
          ? {
              authenticated: true,
              account: { provider: "openrouter" },
              profile: {
                provider: "openrouter",
                name: "Studio member",
                email: "member@example.test",
              },
              connections: [
                {
                  provider: "openrouter",
                  connected: true,
                  model: "openrouter/free",
                },
              ],
              vault: { available: true },
            }
          : { authenticated: false, profile: null, connections: [] },
      ),
    })
  })

  await prepareHomePage(page)
  await expect(page.getByText("OpenRouter · your budget", { exact: true })).toBeVisible()

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
  await expect(dialog.getByText("OpenRouter connected", { exact: true })).toBeVisible()
  await expect(dialog.getByText(/encrypted in your signed-in account vault/i)).toBeVisible()

  await dialog.getByRole("button", { name: "Sign out", exact: true }).click()
  await dialog.getByRole("button", { name: "Close connections" }).click()
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
  await expect(page.getByText("OpenRouter · your budget", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/AI builds left today|Local build available/)).toBeVisible()
})
