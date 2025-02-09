import { cac } from "cac"
import { type Browser, launch, type Page } from "puppeteer-core"
import { findChrome } from "./find-chrome"
import Queue from "p-queue"
import { toMarkdown } from "./to-markdown"
import { WebSearchError } from "./error"
import { shouldSkipDomain } from "./utils"
import { loadConfig } from "./config"
import { getReadabilityScript } from "./readability" with { type: "macro" }

type SearchResult = {
  title: string
  url: string
  content?: string
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
      // "--disable-web-security",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: {
      width: 1280,
      height: 720,
    },
    downloadBehavior: {
      policy: "deny",
    },
  })

  return {
    context,
  }
}

type SearchTopic = "general" | "news"

type Options = {
  query?: string | string[]
  concurrency?: number
  show?: boolean
  maxResults?: number
  browser?: string
  excludeDomain?: string | string[]
  topic?: SearchTopic
}

async function main() {
  const cli = cac()

  cli
    .command("search", "run search")
    .option("-q, --query <query>", "The search query")
    .option("-c, --concurrency <concurrency>", "concurrency")
    .option("--show", "Show browser")
    .option("--max-results <num>", "Max search results")
    .option("--browser <browser>", "Choose a browser to use")
    .option("--exclude-domain <domain>", "Exclude domains from the result")
    .option("--topic <topic>", "The search topic")
    .action(async (_options: Options) => {
      const options: Options = {
        ...loadConfig(),
        ..._options,
      }

      if (!options.query) {
        throw new Error("missing query")
      }

      const queries = Array.isArray(options.query)
        ? options.query
        : [options.query]

      const excludeDomains = Array.isArray(options.excludeDomain)
        ? options.excludeDomain
        : options.excludeDomain
          ? [options.excludeDomain]
          : []

      // limit the max results for each query, minimal 3
      const maxResults =
        options.maxResults &&
        Math.max(3, Math.floor(options.maxResults / queries.length))

      const browserName = options.browser
      const { context } = await launchBrowser({
        show: options.show,
        browser: browserName,
      })

      process.stdin.on("data", (data) => {
        handleStdin(data, context)
      })

      try {
        const queue = new Queue({ concurrency: options.concurrency || 15 })

        const visitedUrls = new Set<string>()

        await Promise.all(
          queries.map((query) =>
            search(context, {
              query,
              maxResults,
              queue,
              visitedUrls,
              excludeDomains,
              topic: options.topic,
            }),
          ),
        )
        await context.close()
        process.exit()
      } catch (error) {
        await context.close()
        handleError(error)
      }
    })

  cli.help()

  try {
    cli.parse(process.argv, { run: false })
    await cli.runMatchedCommand()
  } catch (error) {
    handleError(error)
  }
}

process.stdin.on("data", (data) => {
  handleStdin(data)
})

main()

async function handleStdin(data: Buffer, context?: Browser) {
  const str = data.toString().trim()
  if (str === "exit") {
    if (context) {
      await context.close()
    }
    process.exit()
  }
}

function handleError(error: unknown) {
  if (error instanceof WebSearchError) {
    console.error(error.message)
  } else if (error instanceof Error && error.name === "CACError") {
    console.error(error.message)
  } else {
    console.error(error)
  }

  process.exit(1)
}

async function search(
  context: Browser,
  options: {
    query: string
    maxResults?: number
    queue: Queue
    visitedUrls: Set<string>
    excludeDomains: string[]
    topic?: SearchTopic
  },
) {
  const page = await context.newPage()

  await interceptRequest(page)

  const searchParams = new URLSearchParams({
    q: `${
      options.excludeDomains.length > 0
        ? `${options.excludeDomains.map((domain) => `-site:${domain}`).join(" ")} `
        : ""
    }${options.query}`,

    num: `${options.maxResults || 10}`,
  })

  if (options.topic === "news") {
    searchParams.set("tbm", "nws")
  }

  const url = `https://www.google.com/search?${searchParams.toString()}`

  await page.goto(url, {
    waitUntil: "networkidle2",
  })

  let links = await page.evaluate((topic) => {
    const links: SearchResult[] = []

    if (topic === "news") {
      const elements = document.querySelectorAll("[data-news-cluster-id]")
      elements.forEach((element) => {
        const linkEl = element.querySelector("a")
        const url = linkEl?.getAttribute("href")

        if (!url) return

        const titleEl = element.querySelector('[role="heading"]')
        const title = titleEl?.textContent || ""
        if (!title) return

        const snippetEl = titleEl?.nextElementSibling
        const snippet = snippetEl?.textContent || ""
        links.push({
          url,
          title,
          content: snippet,
        })
      })
    } else {
      const elements = document.querySelectorAll(".g")
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
    }

    return links
  }, options.topic)

  links = links.filter((link) => {
    if (options.visitedUrls.has(link.url)) return false

    options.visitedUrls.add(link.url)

    return !shouldSkipDomain(link.url)
  })

  console.log(
    "-->",
    JSON.stringify({
      query: options.query,
      results: links,
    }),
  )

  const finalResults = await Promise.allSettled(
    links.map((item) => options.queue.add(() => visitLink(context, item.url))),
  )

  console.log(
    "-->",
    JSON.stringify({
      query: options.query,
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
    content: getReadabilityScript(),
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
