export const shouldSkipDomain = (url: string) => {
  const { hostname } = new URL(url)

  return [
    "reddit.com",
    "x.com",
    "twitter.com",
    // TODO: maybe fetch transcript for youtube videos
    "youtube.com",
    "www.youtube.com",
  ].includes(hostname)
}
