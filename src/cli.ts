import { cac } from "cac"
import Queue from "p-queue"
import { toMarkdown } from "./to-markdown"
import { WebSearchError } from "./error"
import { SELECTORS_TO_REMOVE, shouldSkipDomain } from "./utils"
import { loadConfig } from "./config"
import { getReadabilityScript } from "./macro" with { type: "macro" }
import { getSearchPageLinks } from "./extract"
import { launchBrowser, type BrowserMethods } from "./browser"
import { writeStdout } from "./stdio"
import { getBrowserProfiles } from "./find-browser"

export type SearchResult = {
  title: string
  url: string
  content?: string
}

type Options = {
  query?: string | string[]
  concurrency?: number
  show?: boolean
  maxResults?: number
  browser?: string
  excludeDomain?: string | string[]
  /** keepp the first {number} of characters in each page */
  truncate?: number
  proxy?: string
  executablePath?: string
  profilePath?: string
}

async function main() {
  const cli = cac()

  cli
    .command("list-profiles")
    .option("--browser <browser>", "Choose a browser to use")
    .action(async ({ browser }: { browser?: string }) => {
      try {
        const profiles = getBrowserProfiles(browser)
        console.log(JSON.stringify(profiles))
        process.exit()
      } catch (error) {
        handleError(error)
      }
    })

  cli
    .command("search", "run search")
    .option("-q, --query <query>", "The search query")
    .option("-c, --concurrency <concurrency>", "concurrency")
    .option("--show", "Show browser")
    .option("--max-results <num>", "Max search results per query")
    .option("--browser <browser>", "Choose a browser to use")
    .option("--exclude-domain <domain>", "Exclude domains from the result")
    .option("--truncate <num>", "Truncate page content")
    .option("--proxy <proxy>", "Use a proxy")
    .option("--profile-path <path>", "The path to the browser profile")
    .action(async ({ ..._options }: Options) => {
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

      const maxResults = options.maxResults

      const browser = await launchBrowser({
        show: options.show,
        browser: options.browser,
        proxy: options.proxy,
        executablePath: options.executablePath,
        profilePath: options.profilePath,
      })

      process.stdin.on("data", (data) => {
        handleStdin(data, browser)
      })

      try {
        const queue = new Queue({ concurrency: options.concurrency || 15 })

        const visitedUrls = new Set<string>()

        await Promise.all(
          queries.map((query) =>
            search(browser, {
              query,
              maxResults,
              queue,
              visitedUrls,
              excludeDomains,
              truncate: options.truncate,
            }),
          ),
        )
        await browser.close()
        process.exit()
      } catch (error) {
        await browser.close()
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

async function handleStdin(data: Buffer, browser?: BrowserMethods) {
  const str = data.toString().trim()
  if (str === "exit") {
    if (browser) {
      await browser.close()
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

type SearchOptions = {
  query: string
  maxResults?: number
  excludeDomains: string[]
  truncate?: number
}

function getSearchUrl(options: SearchOptions) {
  const searchParams = new URLSearchParams({
    q: `${
      options.excludeDomains.length > 0
        ? `${options.excludeDomains.map((domain) => `-site:${domain}`).join(" ")} `
        : ""
    }${options.query}`,

    num: `${options.maxResults || 10}`,
  })

  // web tab
  searchParams.set("udm", "14")

  const url = `https://www.google.com/search?${searchParams.toString()}`

  return url
}

async function search(
  browser: BrowserMethods,
  options: {
    queue: Queue
    visitedUrls: Set<string>
  } & SearchOptions,
) {
  const url = getSearchUrl(options)

  let links = await browser.withPage(async (page) => {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    })
    const result = await page.evaluate(getSearchPageLinks)

    return result
  })

  links =
    links?.filter((link) => {
      if (options.visitedUrls.has(link.url)) return false

      options.visitedUrls.add(link.url)

      return !shouldSkipDomain(link.url)
    }) || null

  if (!links || links.length === 0) return

  await writeStdout(
    `:local-web-search:${JSON.stringify({
      query: options.query,
      results: links,
    })}\n`,
  )

  const finalResults = await Promise.allSettled(
    links.map((item) => options.queue.add(() => visitLink(browser, item.url))),
  )

  await writeStdout(
    `:local-web-search:${JSON.stringify({
      query: options.query,
      results: finalResults
        .map((item) => {
          if (item.status === "rejected" || !item.value) return null

          return {
            ...item.value,
            content: options.truncate
              ? item.value.content.slice(0, options.truncate)
              : item.value.content,
          }
        })
        .filter((v) => v?.content),
    })}\n`,
  )
}

async function visitLink(browser: BrowserMethods, url: string) {
  const readabilityScript = await getReadabilityScript()
  const result = await browser.withPage(async (page) => {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    })
    return await page.evaluate(
      ([readabilityScript, selectorsToRemove]) => {
        const Readability = new Function(
          "module",
          `${readabilityScript}\nreturn module.exports`,
        )({})

        const document = window.document

        document
          .querySelectorAll(selectorsToRemove.join(","))
          .forEach((el) => el.remove())

        const article = new Readability(document).parse()

        const content = article?.content || ""
        const title = document.title

        return { content, title: article?.title || title }
      },
      [readabilityScript, SELECTORS_TO_REMOVE] as const,
    )
  })

  if (!result) return null

  const content = toMarkdown(result.content)

  return { ...result, url, content: content }
}
