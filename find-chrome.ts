import fs from "node:fs"
import { BrowserNotFoundError } from "./error"

interface Browser {
  name: string
  win32: string
  darwin: string
}

const browsers: Browser[] = [
  {
    name: "Brave",
    win32:
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    darwin: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  },
  {
    name: "Chromium",
    win32: "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    darwin: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  },
  {
    name: "Google Chrome Canary",
    win32: "C:\\Program Files\\Google\\Chrome Canary\\Application\\chrome.exe",
    darwin:
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  },
  {
    name: "Google Chrome",
    win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
  {
    name: "Microsoft Edge Canary",
    win32:
      "C:\\Program Files (x86)\\Microsoft\\Edge Canary\\Application\\msedge.exe",
    darwin:
      "/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
  },
  {
    name: "Microsoft Edge",
    win32: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    darwin: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  },
]

export function findChrome(name?: string): string {
  const browser = name
    ? browsers.find((b) => b.name === name)
    : browsers.find((browser) =>
        fs.existsSync(
          browser[process.platform === "darwin" ? "darwin" : "win32"],
        ),
      )

  if (!browser) {
    if (name) {
      throw new BrowserNotFoundError(`Cannot find browser: ${name}`)
    }

    throw new BrowserNotFoundError(
      "Cannot find a chrome-based browser on your system, please install one of: Chrome, Edge, Brave",
    )
  }

  return process.platform === "darwin" ? browser.darwin : browser.win32
}
