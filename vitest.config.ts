import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const localChromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/snap/bin/chromium"
const executablePath =
  !process.env.CI && existsSync(localChromiumPath)
    ? localChromiumPath
    : undefined

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
          }),
        ],
        test: {
          name: "storybook",
          fileParallelism: false,
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: executablePath ? { executablePath } : undefined,
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
})
