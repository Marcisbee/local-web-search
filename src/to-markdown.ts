import Turndown from "turndown"
import { gfm } from "turndown-plugin-gfm"

const turndown = new Turndown({
  codeBlockStyle: "fenced",
})
turndown.use(gfm)

export function toMarkdown(html: string) {
  return turndown.turndown(html)
}
