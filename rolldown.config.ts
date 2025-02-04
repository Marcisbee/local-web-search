import { defineConfig } from "rolldown"
import fs from "node:fs"
import pkg from "./package.json"

const readabilityScript = fs.readFileSync(
  "node_modules/@mozilla/readability/Readability.js",
  "utf-8"
)

export default defineConfig({
  input: ["./cli.ts"],
  output: {
    dir: "dist",
    format: "esm",
  },
  define: {
    __READABILITY_SCRIPT__: JSON.stringify(
      `var Readability=(function(module){${readabilityScript}\nreturn module.exports})({})`
    ),
  },
  external: Object.keys(pkg.dependencies || {}),
})
