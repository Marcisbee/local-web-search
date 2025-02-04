import fs from "node:fs"

interface Browser {
  path: string
  weight: number
}

const windowsBrowsers: Browser[] = [
  {
    path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    weight: 46,
  },
  {
    path: "C:\\Program Files (x86)\\Microsoft\\Edge Canary\\Application\\msedge.exe",
    weight: 48,
  },
  {
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    weight: 50,
  },
  {
    path: "C:\\Program Files\\Google\\Chrome Canary\\Application\\chrome.exe",
    weight: 52,
  },
  {
    path: "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    weight: 54,
  },
  {
    path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    weight: 56,
  },
]

const macBrowsers: Browser[] = [
  {
    path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    weight: 46,
  },
  {
    path: "/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
    weight: 48,
  },
  {
    path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    weight: 50,
  },
  {
    path: "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    weight: 52,
  },
  {
    path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    weight: 54,
  },
  {
    path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    weight: 56,
  },
]

export function findChrome(): string {
  let browsers: Browser[]

  // Check the operating system using Node's process.platform
  if (process.platform === "win32") {
    browsers = windowsBrowsers
  } else if (process.platform === "darwin") {
    browsers = macBrowsers
  } else {
    throw new Error(`Unsupported operating system: ${process.platform}`)
  }

  // Filter the browsers that exist on the file system
  const available = browsers.filter((b) => fs.existsSync(b.path))

  if (available.length === 0) {
    throw new Error(
      "Cannot find a chrome-based browser on your system, please install one of: Chrome, Edge, Brave",
    )
  }

  // Sort browsers descending by weight
  available.sort((a, b) => b.weight - a.weight)

  return available[0].path
}
