import { cac } from "cac"
import { type Browser, launch, type Page } from "puppeteer-core"
import { findChrome } from "./find-chrome"
import Limit from "p-limit"
import { toMarkdown } from "./to-markdown"
import { WebSearchError } from "./error"

type SearchResult = {
  title: string
  url: string
  content?: string
}

const stripQuotes = (text: string) => {
  return text.replace(/^"|"$/g, "")
}

const launchBrowser = async (options: { show?: boolean; browser?: string }) => {
  const context = await launch({
    executablePath: findChrome(options.browser),
    headless: !options.show,
    args: [
      // "--enable-webgl",
      // "--use-gl=swiftshader",
      // "--enable-accelerated-2d-canvas",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: {
      width: 1280,
      height: 720,
    },
  })

  return {
    context,
    [Symbol.asyncDispose]: async () => {
      await context.close()
    },
  }
}

async function main() {
  const cli = cac()

  cli
    .command("search", "run search")
    .option("-k, --keyword <keyword>", "keyword to search")
    .option("-c, --concurrency <concurrency>", "concurrency")
    .option("--show", "Show browser")
    .option("--max-results <num>", "Max search results")
    .option("--browser <browser>", "Choose a browser to use")
    .action(
      async (options: {
        keyword?: string | string[]
        concurrency?: number
        show?: boolean
        maxResults?: number
        browser?: string
      }) => {
        if (!options.keyword) {
          throw new Error("missing keyword")
        }

        await using browser = await launchBrowser({
          show: options.show,
          browser: options.browser,
        })
        const { context } = browser

        const keywords = Array.isArray(options.keyword)
          ? options.keyword
          : [options.keyword]

        await Promise.all(
          keywords.map((keyword) =>
            search(context, {
              keyword,
              concurrency: options.concurrency,
              maxResults: options.maxResults,
            }),
          ),
        )
      },
    )

  cli.help()

  try {
    cli.parse(process.argv, { run: false })
    await cli.runMatchedCommand()
  } catch (error) {
    process.exitCode = 1

    if (error instanceof WebSearchError) {
      console.error(error.message)
    } else {
      console.error(error)
    }
  }
}

main()

async function search(
  context: Browser,
  options: { keyword: string; concurrency?: number; maxResults?: number },
) {
  const page = await context.newPage()

  await interceptRequest(page)
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    stripQuotes(options.keyword),
  )}&num=${options.maxResults || 10}`

  await page.goto(url, {
    waitUntil: "networkidle2",
  })

  const links = await page.evaluate(() => {
    const elements = document.querySelectorAll(".g")

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

  console.log("-->", {
    keyword: options.keyword,
    results: JSON.stringify(links),
  })

  const limit = Limit(options.concurrency || 20)

  const finalResults = await Promise.allSettled(
    links.map((item) => limit(() => visitLink(context, item.url))),
  )

  console.log(
    "-->",
    JSON.stringify({
      keyword: options.keyword,
      results: finalResults
        .map((item) => (item.status === "fulfilled" ? item.value : null))
        .filter((v) => v?.content),
    }),
  )
}

async function interceptRequest(page: Page) {
  await applyStealthScripts(page)
  await page.setRequestInterception(true)

  page.on("request", (request) => {
    if (request.isNavigationRequest()) {
      return request.continue()
    }

    return request.abort()
  })
}

async function visitLink(context: Browser, url: string) {
  const page = await context.newPage()

  await interceptRequest(page)

  await page.goto(url, {
    waitUntil: "networkidle2",
  })

  await page.addScriptTag({
    content: __READABILITY_SCRIPT__,
  })

  const result = await page.evaluate(() => {
    const selectorsToRemove = [
      "script,noscript,style,link,svg,img,video,iframe,canvas",
      // wikipedia refs
      ".reflist",
    ]
    document
      .querySelectorAll(selectorsToRemove.join(","))
      .forEach((el) => el.remove())

    const article = new Readability(document).parse()
    const content = article?.content || ""
    const title = document.title

    return { content, title: article?.title || title }
  })

  await page.close()

  const content = toMarkdown(result.content)
  console.log(content)
  return { ...result, url, content: content }
}

async function applyStealthScripts(page: Page) {
  await page.setBypassCSP(true)
  await page.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36`,
  )
  await page.evaluate(() => {
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
