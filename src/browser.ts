import { launch, Page } from "puppeteer-core"
import { findChrome } from "./find-chrome"
import { domFetchAndEvaluate } from "./dom"

type RealBrowserOptions = {
  type: "real"
  show?: boolean
  browser?: string
}

type FakeBrowserOptions = {
  type: "fake"
}

type Options = RealBrowserOptions | FakeBrowserOptions

export type BrowserMethods = {
  close: () => Promise<void>

  evaluateOnPage: <T extends any[], R>(
    url: string,
    fn: (window: Window, ...args: T) => R,
    fnArgs: T,
  ) => Promise<R | null>
}

export const launchBrowser = async (options: Options) => {
  if (options.type === "real") {
    return launchRealBrowser(options)
  }

  return launchFakeBrowser(options)
}

const launchRealBrowser = async (
  options: RealBrowserOptions,
): Promise<BrowserMethods> => {
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
    close: async () => {
      context.close()
    },

    evaluateOnPage: async (url, fn, fnArgs) => {
      const page = await context.newPage()

      await interceptRequest(page)
      await page.goto(url, {
        waitUntil: "networkidle2",
      })

      const win = await page.evaluateHandle(() => window)
      const result = await page.evaluate(fn, win, ...fnArgs)
      await win.dispose()

      return result
    },
  }
}

const launchFakeBrowser = async (
  options: FakeBrowserOptions,
): Promise<BrowserMethods> => {
  return {
    close: async () => {},

    evaluateOnPage: async (url, fn, fnArgs) => {
      const result = await domFetchAndEvaluate(
        url,
        (window, ...args) => fn(window as any, ...args),
        fnArgs,
      )

      return result
    },
  }
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
