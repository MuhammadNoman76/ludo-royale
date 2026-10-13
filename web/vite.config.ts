import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

// The page's Content Security Policy, added to the built index.html. The web server sends stricter
// headers on top (public/_headers); inside the Windows app this meta tag is the policy.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'self'",
].join("; ");

/** Ships the third-party licence texts with the client (shown in Settings). */
function notices(): Plugin {
  return {
    name: "ludo-notices",
    apply: "build",
    generateBundle() {
      const source = fileURLToPath(new URL("../THIRD-PARTY-NOTICES.txt", import.meta.url));
      this.emitFile({ type: "asset", fileName: "third-party-notices.txt", source: readFileSync(source, "utf8") });
    },
  };
}

function csp(): Plugin {
  return {
    name: "ludo-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<meta charset=\"utf-8\" />", `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: "public",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  server: { port: 5173, fs: { allow: [".."] } },
  plugins: [csp(), notices()],
});
