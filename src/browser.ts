import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { chromium, type Page } from "playwright-core"
import { findBrowser } from "./find-browser"

type BrowserOptions = {
  show?: boolean
  browser?: string
  proxy?: string
  executablePath?: string
  profilePath?: string
}

export type BrowserMethods = {
  close: () => Promise<void>

  withPage: <T>(fn: (page: Page) => T | Promise<T>) => Promise<T>
}

export const launchBrowser = async (
  options: BrowserOptions,
): Promise<BrowserMethods> => {
  const userDataDir = options.profilePath
    ? path.dirname(options.profilePath)
    : path.join(os.tmpdir(), "local-web-search-user-dir-temp")

  if (!fs.existsSync(userDataDir)) {
    const defaultPreferences = {
      plugins: {
        always_open_pdf_externally: true,
      },
    }

    const defaultProfileDir = path.join(userDataDir, "Default")
    fs.mkdirSync(defaultProfileDir, { recursive: true })

    fs.writeFileSync(
      path.join(defaultProfileDir, "Preferences"),
      JSON.stringify(defaultPreferences),
    )
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath:
      options.executablePath || findBrowser(options.browser).executable,
    headless: !options.show,
    args: [
      // "--enable-webgl",
      // "--use-gl=swiftshader",
      // "--enable-accelerated-2d-canvas",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      options.profilePath
        ? `--profile-directory=${path.basename(options.profilePath)}`
        : null,
    ].filter((v) => v !== null),
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    locale: "en-US",
    acceptDownloads: false,
    bypassCSP: true,
    hasTouch: true,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/237.84.2.178 Safari/537.36`,
    ignoreHTTPSErrors: true,
    handleSIGHUP: true,
    handleSIGINT: true,
    handleSIGTERM: true,
    chromiumSandbox: false,
    proxy: options.proxy
      ? {
          server: options.proxy,
        }
      : undefined,
  })

  return {
    close: async () => {
      const pages = context.pages()
      await Promise.all(pages.map((page) => page.close()))
      await context.close()
    },

    withPage: async (fn) => {
      const page = await context.newPage()

      try {
        await interceptRequest(page)
        const result = await fn(page)
        await page.close()
        return result
      } catch (error) {
        await page.close()
        throw error
      }
    },
  }
}

async function interceptRequest(page: Page) {
  await applyStealthScripts(page)

  await page.route("**/*", (route) => {
    if (route.request().resourceType() !== "document") {
      return route.abort()
    }

    return route.continue()
  })
}

async function applyStealthScripts(page: Page) {
  await page.addInitScript(() => {
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
