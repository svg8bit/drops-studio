import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)

export default defineConfig({
  optimizeDeps: {
    include: ["next/dynamic"],
  },
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
})
