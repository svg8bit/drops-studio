import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import { pipeline } from "node:stream/promises"

const host = "127.0.0.1"
const port = 6006
const root = resolve("outputs/storybook-static")
const indexPath = resolve(root, "index.html")

if (!existsSync(indexPath)) {
  throw new Error(
    "Static Storybook build is missing. Run `npm run build-storybook` before visual tests."
  )
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`)
    const pathname = decodeURIComponent(requestUrl.pathname)
    let filePath = resolve(root, `.${pathname}`)

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden")
      return
    }

    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = resolve(filePath, "index.html")

    const file = await stat(filePath)
    if (!file.isFile()) throw new Error("Not a file")

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": String(file.size),
      "content-type":
        contentTypes.get(extname(filePath).toLowerCase()) ??
        "application/octet-stream",
    })
    await pipeline(createReadStream(filePath), response)
  } catch {
    if (response.headersSent) {
      if (!response.destroyed) response.destroy()
      return
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("Not found")
  }
})

server.listen(port, host, () => {
  console.log(`Static Storybook ready at http://${host}:${port}`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
