export const shouldSkipDomain = (url: string) => {
  const { hostname } = new URL(url)

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
