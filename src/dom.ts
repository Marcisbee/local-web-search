import { Window } from "happy-dom"
import * as undici from "undici"

export async function domFetchAndEvaluate<T, TArg extends any[]>(
  url: string,
  fn: (window: Window, ...args: TArg) => T,
  fnArgs: TArg,
): Promise<T | null> {
  const res = await undici.fetch(url, {
    dispatcher: new undici.Agent({
      connect: {
        // bypass SSL failures
        rejectUnauthorized: false,
      },
      maxRedirections: 5,
    }),
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36",
    },
  })

  if (!res.ok) {
    console.error(`failed to fetch ${url}, status: ${res.status}`)
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

  const window = new Window({
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
    window.document.write(html)
    await window.happyDOM.waitUntilComplete()
    const result = fn(window, ...fnArgs)
    await window.happyDOM.close()
    return result
  } catch (error) {
    await window.happyDOM.close()
    console.error(url, error)
    return null
  }
}
