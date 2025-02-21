const parseUrl = (url: string) => {
  try {
    return new URL(url)
  } catch (error) {
    return null
  }
}

export const shouldSkipDomain = (url: string) => {
  const parsed = parseUrl(url)

  if (!parsed) return true

  const { hostname } = parsed

  return [
    "reddit.com",
    "www.reddit.com",
    "x.com",
    "twitter.com",
    "www.twitter.com",
    // TODO: maybe fetch transcript for youtube videos
    "youtube.com",
    "www.youtube.com",
  ].includes(hostname)
}

export const stripHTML = (html: string) => {
  return html.replace(/<[^>]*>?/g, "")
}

export const SELECTORS_TO_REMOVE: readonly string[] = [
  "script,noscript,style,link,svg,img,video,iframe,canvas",
  // wikipedia refs
  ".reflist",
]
