import fs from "node:fs"

export const getReadabilityScript = () => {
  const code = fs.readFileSync(
    "node_modules/@mozilla/readability/Readability.js",
    "utf-8",
  )
  return `var Readability=(function(module){${code}\nreturn module.exports})({})`
}
