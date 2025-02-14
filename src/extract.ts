// note: we can't import other code here but only types
// since this function runs in the browser

import type { SearchResult, SearchTopic } from "./cli"

export function getSearchPageLinks(window: Window, topic?: SearchTopic) {
  const links: SearchResult[] = []
  const document = window.document

  const isValidUrl = (url: string) => {
    try {
      new URL(url)
      return true
    } catch (error) {
      return false
    }
  }

  try {
    if (topic === "news") {
      const elements = document.querySelectorAll("[data-news-cluster-id]")
      elements.forEach((element) => {
        const linkEl = element.querySelector("a")
        const url = linkEl?.getAttribute("href")

        if (!url || !isValidUrl(url)) return

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
        const url = urlEl?.getAttribute("href")

        if (!url || !isValidUrl(url)) return

        const item: SearchResult = {
          title: titleEl?.textContent || "",
          url,
        }

        if (!item.title || !item.url) return

        links.push(item)
      })
    }
  } catch (error) {
    console.error(error)
  }

  return links
}
