// Builds vendor/privy-bridge.js for GitHub Pages. The live site does not run this.
import { readFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const cssPlugin = {
  name: "inline-css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      const contents = `if (typeof document !== "undefined") {
        const node = document.createElement("style");
        node.textContent = ${JSON.stringify(css)};
        document.head.append(node);
      }`;
      return { contents, loader: "js" };
    });
  },
};

await esbuild.build({
  entryPoints: ["scripts/privy-bridge.js"],
  outfile: "vendor/privy-bridge.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  plugins: [cssPlugin],
  logLevel: "info",
});
