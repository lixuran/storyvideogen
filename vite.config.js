import { defineConfig } from "vite";
import path from "node:path";
import {fileURLToPath} from "node:url";

const webRoot = path.dirname(fileURLToPath(new URL("./web/index.html", import.meta.url)));

export default defineConfig({
  root: "web",
  esbuild: {
    jsx: "automatic"
  },
  build: {
    outDir: "../web/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(webRoot, "app.html"),
        legacy: path.resolve(webRoot, "index.html")
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7860"
    }
  }
});
