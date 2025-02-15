import { Browser } from "happy-dom"
import * as undici from "undici"
import { getSystemProxy } from "os-proxy-config"

const proxyPromise = getSystemProxy()

export async function domFetchAndEvaluate<T, TArg extends any[]>(
  url: string,
  fn: (window: Window, ...args: TArg) => T,
  fnArgs: TArg,
): Promise<T | null> {
  const proxy = await proxyPromise
  const agentOptions: undici.Agent.Options = {
    connect: {
      // bypass SSL failures
      rejectUnauthorized: false,
    },
    maxRedirections: 5,
  }

  const proxyUrl =
    process.env.HTTP_PROXY ||
    (proxy && proxy.proxyUrl.replace("https://", "http://"))

  const res = await undici
    .fetch(url, {
      dispatcher: proxyUrl
        ? new undici.ProxyAgent({
            ...agentOptions,
            uri: proxyUrl,
          })
        : new undici.Agent({
            ...agentOptions,
          }),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36",
      },
    })
    .catch((err) => {
      console.error(err)
      return null
    })

  if (!res?.ok) {
    console.error(`failed to fetch ${url}, status: ${res?.status || "unknown"}`)
    return null
  }

  const contentType = res.headers.get("content-type")

  if (!contentType?.includes("text")) {
    return null
  }

  if (!contentType.includes("html")) {
    return null
  }

  const html = await res.text()

  const browser = new Browser({
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      timer: {
        maxTimeout: 3000,
        maxIntervalTime: 3000,
      },
    },
  })

  try {
    const page = browser.newPage()

    page.url = url
    page.content = html

    await page.waitUntilComplete()

    const result = fn(page.mainFrame.window as any, ...fnArgs)
    await browser.close()
    return result
  } catch (error) {
    await browser.close()
    console.error(url, error)
    return null
  }
}
