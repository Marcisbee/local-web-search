import path from "node:path"
import { tmpdir } from "node:os"
import { cac } from "cac"
import { chromium, type BrowserContext, type Page } from "playwright-core"
import { findChrome } from "./find-chrome"
import Limit from "p-limit"
import { toMarkdown } from "./to-markdown"

type SearchResult = {
  title: string
  url: string
  content?: string
}

async function main() {
  const cli = cac()

  cli
    .command("search", "run search")
    .option("-k, --keyword <keyword>", "keyword to search")
    .option("-c, --concurrency <concurrency>", "concurrency")
    .option("--user-data-dir <user-data-dir>", "user data dir")
    .option("--show", "Show browser")
    .action(
      async (options: {
        keyword?: string
        concurrency?: number
        show?: boolean
        userDataDir?: string
      }) => {
        if (!options.keyword) {
          throw new Error("missing keyword")
        }

        const userDataDir =
          options.userDataDir ||
          path.join(tmpdir(), ".local-web-search-user-data")
        const context = await chromium.launchPersistentContext(userDataDir, {
          executablePath: findChrome(),
          headless: !options.show,
          args: [
            // "--enable-webgl",
            // "--use-gl=swiftshader",
            // "--enable-accelerated-2d-canvas",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--lang=en-US",
          ],
          bypassCSP: true,
          // downloadBehavior: { policy: "allow" },
        })

        await applyStealthScripts(context)

        const page = await context.newPage()

        await interceptRequest(page)
        const url = `https://www.google.com/search?newwindow=1&q=${encodeURIComponent(
          options.keyword
        )}`

        await page.goto(url, {
          waitUntil: "networkidle",
        })

        const links = await page.evaluate(() => {
          const elements = document.querySelectorAll(".g")
          console.log(elements)
          const links: SearchResult[] = []

          elements.forEach((element) => {
            const titleEl = element.querySelector("h3")
            const urlEl = element.querySelector("a")

            const item: SearchResult = {
              title: titleEl?.textContent || "",
              url: urlEl?.getAttribute("href") || "",
            }

            if (!item.title || !item.url) return

            links.push(item)
          })

          return links
        })

        console.log("-->", JSON.stringify(links))

        const limit = Limit(options.concurrency || 20)

        const finalResults = await Promise.all(
          links.map((item) => limit(() => visitLink(context, item.url)))
        )

        console.log("-->", JSON.stringify(finalResults))

        await context.close()
      }
    )

  cli.help()
  cli.parse()
}

main()

async function interceptRequest(page: Page) {
  await page.route("**/*", (route) => {
    const request = route.request()

    if (request.isNavigationRequest()) {
      return route.continue()
    }

    return route.abort()
  })
}

async function visitLink(context: BrowserContext, url: string) {
  const page = await context.newPage()

  await interceptRequest(page)

  await page.goto(url, {
    waitUntil: "networkidle",
  })

  await page.addScriptTag({
    content: __READABILITY_SCRIPT__,
  })

  const result = await page.evaluate(() => {
    document
      .querySelectorAll(`script,noscript,style,link,svg,img`)
      .forEach((el) => el.remove())

    const article = new Readability(document).parse()
    const content = article?.content || ""
    const title = document.title

    return { content, title: article?.title || title }
  })

  await page.close()

  return { ...result, url, content: toMarkdown(result.content) }
}

async function applyStealthScripts(context: BrowserContext) {
  await context.addInitScript(() => {
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    })

    // Mock languages and plugins to mimic a real browser
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    })

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    })

    // Remove Playwright-specific properties
    // @ts-expect-error
    delete window.__playwright
    // @ts-expect-error
    delete window.__pw_manual
    // @ts-expect-error
    delete window.__PW_inspect

    // Redefine the headless property
    Object.defineProperty(navigator, "headless", {
      get: () => false,
    })

    // Override the permissions API
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters)
  })
}
