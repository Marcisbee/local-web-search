import { Window } from "happy-dom"

export async function domFetchAndEvaluate<T, TArg extends any[]>(
  url: string,
  fn: (window: Window, ...args: TArg) => T,
  fnArgs: TArg,
): Promise<T | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36",
    },
  })

  if (!res.ok) {
    console.error(`failed to fetch ${url}, status: ${res.status}`)
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
    console.error(error)
    return null
  }
}
