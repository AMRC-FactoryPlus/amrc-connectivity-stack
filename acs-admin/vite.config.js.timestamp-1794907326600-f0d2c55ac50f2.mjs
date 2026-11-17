// vite.config.js
import { fileURLToPath, URL } from "node:url";
import * as nodeFs from "node:fs";
import { defineConfig } from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/vite/dist/node/index.js";
import vue from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import VueDevTools from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/vite-plugin-vue-devtools/dist/vite.mjs";
import importMetaEnv from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/@import-meta-env/unplugin/dist/index.js";
import process from "process";
import inject from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/@rollup/plugin-inject/dist/es/index.js";
import path from "node:path";
import monacoEditorEsmPlugin from "file:///workspaces/amrc-connectivity-stack/acs-admin/node_modules/vite-plugin-monaco-editor-esm/dist/index.js";
var __vite_injected_original_dirname = "/workspaces/amrc-connectivity-stack/acs-admin";
var __vite_injected_original_import_meta_url = "file:///workspaces/amrc-connectivity-stack/acs-admin/vite.config.js";
var EMPTY = path.resolve(__vite_injected_original_dirname, "./emptyModule.js");
var src = (d) => fileURLToPath(new URL(`./src/${d}`, __vite_injected_original_import_meta_url));
function stripMonacoInlineScript() {
  const MARKER = 'self["MonacoEnvironment"]';
  return {
    name: "acs-strip-monaco-inline-script",
    enforce: "post",
    transformIndexHtml(html) {
      const re = /<script>[^<]*self\["MonacoEnvironment"\][\s\S]*?<\/script>/;
      if (!re.test(html)) {
        throw new Error(
          `acs-strip-monaco-inline-script: no script containing ${MARKER} found in index.html. The Monaco plugin's injection has changed; check whether src/main.js still needs to define MonacoEnvironment, and whether the worker paths there are still correct.`
        );
      }
      return html.replace(re, "");
    }
  };
}
var vite_config_default = defineConfig({
  define: {
    process,
    global: "window"
  },
  build: {
    target: "esnext",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      treeshake: "safest"
    },
    commonjsOptions: {
      strictRequires: true,
      transformMixedEsModules: true
    }
  },
  optimizeDeps: {
    include: ["buffer"],
    esbuildOptions: {
      target: "esnext"
    }
  },
  plugins: [
    importMetaEnv.vite({
      env: ".env",
      example: ".env.example",
      files: ["dist/env.js"]
      // the placeholder lives here, not in index.html
    }),
    vue({
      script: {
        fs: {
          fileExists(file) {
            return nodeFs.existsSync(file);
          },
          readFile(file) {
            return nodeFs.readFileSync(file, "utf-8");
          }
        }
      }
    }),
    VueDevTools(),
    inject({
      Buffer: ["buffer", "Buffer"]
    }),
    monacoEditorEsmPlugin({
      languageWorkers: ["editorWorkerService", "json"],
      customWorkers: [
        {
          label: "yaml",
          entry: "monaco-yaml",
          worker: {
            id: "monaco-yaml/yamlWorker",
            entry: "monaco-yaml/yaml.worker"
          }
        }
      ],
      globalAPI: true
    }),
    stripMonacoInlineScript()
  ],
  server: {
    proxy: {
      // The i3X Explorer has its own dev server (npm run
      // dev:i3x-explorer); the Explorer page frames it from here.
      "/i3x-explorer/": { target: "http://localhost:5174", ws: true }
    }
  },
  resolve: {
    alias: {
      "@": src(""),
      "@components": src("components"),
      "@utils": src("utils"),
      "@composables": src("composables"),
      "@pages": src("pages"),
      "@store": src("store"),
      "got": EMPTY,
      "got-fetch": EMPTY,
      "gssapi.js": EMPTY,
      "@amrc-factoryplus/gssapi": EMPTY,
      "path": "path-browserify",
      "buffer": "buffer/"
    },
    preserveSymlinks: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvd29ya3NwYWNlcy9hbXJjLWNvbm5lY3Rpdml0eS1zdGFjay9hY3MtYWRtaW5cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi93b3Jrc3BhY2VzL2FtcmMtY29ubmVjdGl2aXR5LXN0YWNrL2Fjcy1hZG1pbi92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vd29ya3NwYWNlcy9hbXJjLWNvbm5lY3Rpdml0eS1zdGFjay9hY3MtYWRtaW4vdml0ZS5jb25maWcuanNcIjsvKlxuICogQ29weXJpZ2h0IChjKSBVbml2ZXJzaXR5IG9mIFNoZWZmaWVsZCBBTVJDIDIwMjUuXG4gKi9cblxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCwgVVJMIH0gZnJvbSAnbm9kZTp1cmwnXG5pbXBvcnQgKiBhcyBub2RlRnMgZnJvbSAnbm9kZTpmcydcblxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJ1xuaW1wb3J0IFZ1ZURldlRvb2xzIGZyb20gJ3ZpdGUtcGx1Z2luLXZ1ZS1kZXZ0b29scydcbmltcG9ydCBpbXBvcnRNZXRhRW52IGZyb20gJ0BpbXBvcnQtbWV0YS1lbnYvdW5wbHVnaW4nXG5pbXBvcnQgcHJvY2VzcyBmcm9tICdwcm9jZXNzJ1xuaW1wb3J0IGluamVjdCBmcm9tICdAcm9sbHVwL3BsdWdpbi1pbmplY3QnXG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgbW9uYWNvRWRpdG9yRXNtUGx1Z2luIGZyb20gJ3ZpdGUtcGx1Z2luLW1vbmFjby1lZGl0b3ItZXNtJ1xuXG4vLyBYWFggSSdtIG5vdCBzdXJlIHdoeSB3ZSdyZSBtaXhpbmcgX19kaXJuYW1lIGFuZCBpbXBvcnQubWV0YSBoZXJlP1xuY29uc3QgRU1QVFkgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9lbXB0eU1vZHVsZS5qcycpO1xuY29uc3Qgc3JjID0gZCA9PiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoYC4vc3JjLyR7ZH1gLCBpbXBvcnQubWV0YS51cmwpKTtcblxuLyogUmVtb3ZlIHRoZSBpbmxpbmUgc2NyaXB0IHZpdGUtcGx1Z2luLW1vbmFjby1lZGl0b3ItZXNtIGluamVjdHMuXG4gKlxuICogVGhlIHBsdWdpbiBoYXMgbm8gb3B0aW9uIHRvIHNraXAgaXQsIGFuZCBhbiBpbmxpbmUgc2NyaXB0IHdvdWxkIGZvcmNlIHRoZVxuICogY29uc29sZSdzIENvbnRlbnQtU2VjdXJpdHktUG9saWN5IHRvIGFsbG93ICd1bnNhZmUtaW5saW5lJywgd2hpY2ggZGlzYWJsZXNcbiAqIGhhc2hlcyBhbmQgbm9uY2VzIGFsb25nIHdpdGggaXQuIHNyYy9tYWluLmpzIHNldHMgTW9uYWNvRW52aXJvbm1lbnRcbiAqIGluc3RlYWQsIGZyb20gaW5zaWRlIHRoZSBidW5kbGUuXG4gKlxuICogT25seSB0aGUgSFRNTCBpbmplY3Rpb24gZ29lcy4gVGhlIHBsdWdpbidzIHdyaXRlQnVuZGxlIHN0aWxsIGVtaXRzIHRoZVxuICogd29ya2VyIGZpbGVzIHRob3NlIHBhdGhzIHBvaW50IGF0LCBzbyBpdCBzdGF5cyBpbiB0aGUgcGx1Z2luIGxpc3QuXG4gKlxuICogUnVucyBhdCBlbmZvcmNlOiAncG9zdCcgc28gaXQgc2VlcyB0aGUgcGx1Z2luJ3Mgb3V0cHV0LiBJZiB0aGUgcGx1Z2luIGV2ZXJcbiAqIHN0b3BzIGluamVjdGluZywgb3IgcmVuYW1lcyB0aGUgZ2xvYmFsLCB0aGUgYnVpbGQgZmFpbHMgbG91ZGx5IHJhdGhlciB0aGFuXG4gKiBzaWxlbnRseSBsZWF2aW5nIGFuIGlubGluZSBzY3JpcHQgYmVoaW5kIGZvciB0aGUgQ1NQIHRvIHRyaXAgb3Zlci5cbiAqL1xuZnVuY3Rpb24gc3RyaXBNb25hY29JbmxpbmVTY3JpcHQgKCkge1xuICBjb25zdCBNQVJLRVIgPSAnc2VsZltcIk1vbmFjb0Vudmlyb25tZW50XCJdJztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiAnYWNzLXN0cmlwLW1vbmFjby1pbmxpbmUtc2NyaXB0JyxcbiAgICBlbmZvcmNlOiAncG9zdCcsXG4gICAgdHJhbnNmb3JtSW5kZXhIdG1sIChodG1sKSB7XG4gICAgICBjb25zdCByZSA9IC88c2NyaXB0PltePF0qc2VsZlxcW1wiTW9uYWNvRW52aXJvbm1lbnRcIlxcXVtcXHNcXFNdKj88XFwvc2NyaXB0Pi87XG4gICAgICBpZiAoIXJlLnRlc3QoaHRtbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBhY3Mtc3RyaXAtbW9uYWNvLWlubGluZS1zY3JpcHQ6IG5vIHNjcmlwdCBjb250YWluaW5nICR7TUFSS0VSfSBgXG4gICAgICAgICAgKyBgZm91bmQgaW4gaW5kZXguaHRtbC4gVGhlIE1vbmFjbyBwbHVnaW4ncyBpbmplY3Rpb24gaGFzIGNoYW5nZWQ7IGBcbiAgICAgICAgICArIGBjaGVjayB3aGV0aGVyIHNyYy9tYWluLmpzIHN0aWxsIG5lZWRzIHRvIGRlZmluZSBNb25hY29FbnZpcm9ubWVudCwgYFxuICAgICAgICAgICsgYGFuZCB3aGV0aGVyIHRoZSB3b3JrZXIgcGF0aHMgdGhlcmUgYXJlIHN0aWxsIGNvcnJlY3QuYCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gaHRtbC5yZXBsYWNlKHJlLCAnJyk7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGRlZmluZToge1xuICAgIHByb2Nlc3M6IHByb2Nlc3MsXG4gICAgZ2xvYmFsOiAnd2luZG93JyxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlc25leHQnLFxuICAgIG1pbmlmeTogZmFsc2UsXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIHRyZWVzaGFrZTogJ3NhZmVzdCdcbiAgICB9LFxuICAgIGNvbW1vbmpzT3B0aW9uczoge1xuICAgICAgc3RyaWN0UmVxdWlyZXM6IHRydWUsXG4gICAgICB0cmFuc2Zvcm1NaXhlZEVzTW9kdWxlczogdHJ1ZSxcbiAgICB9LFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBpbmNsdWRlOiBbJ2J1ZmZlciddLFxuICAgIGVzYnVpbGRPcHRpb25zOiB7XG4gICAgICB0YXJnZXQ6ICdlc25leHQnLFxuICAgIH1cbiAgfSxcbiAgcGx1Z2luczogW1xuICAgIGltcG9ydE1ldGFFbnYudml0ZSh7XG4gICAgICBlbnY6ICcuZW52JyxcbiAgICAgIGV4YW1wbGU6ICcuZW52LmV4YW1wbGUnLFxuICAgICAgZmlsZXM6IFsnZGlzdC9lbnYuanMnXSwgLy8gdGhlIHBsYWNlaG9sZGVyIGxpdmVzIGhlcmUsIG5vdCBpbiBpbmRleC5odG1sXG4gICAgfSksXG4gICAgdnVlKHtcbiAgICAgIHNjcmlwdDoge1xuICAgICAgICBmczoge1xuICAgICAgICAgIGZpbGVFeGlzdHMoZmlsZSkge1xuICAgICAgICAgICAgcmV0dXJuIG5vZGVGcy5leGlzdHNTeW5jKGZpbGUpXG4gICAgICAgICAgfSxcbiAgICAgICAgICByZWFkRmlsZShmaWxlKSB7XG4gICAgICAgICAgICByZXR1cm4gbm9kZUZzLnJlYWRGaWxlU3luYyhmaWxlLCAndXRmLTgnKVxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pLFxuICAgIFZ1ZURldlRvb2xzKCksXG4gICAgaW5qZWN0KHtcbiAgICAgIEJ1ZmZlcjogWydidWZmZXInLCAnQnVmZmVyJ10sXG4gICAgfSksXG4gICAgbW9uYWNvRWRpdG9yRXNtUGx1Z2luKHtcbiAgICAgIGxhbmd1YWdlV29ya2VyczogWydlZGl0b3JXb3JrZXJTZXJ2aWNlJywgJ2pzb24nXSxcbiAgICAgIGN1c3RvbVdvcmtlcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGxhYmVsOiBcInlhbWxcIixcbiAgICAgICAgICBlbnRyeTogXCJtb25hY28teWFtbFwiLFxuICAgICAgICAgIHdvcmtlcjoge1xuICAgICAgICAgICAgaWQ6IFwibW9uYWNvLXlhbWwveWFtbFdvcmtlclwiLFxuICAgICAgICAgICAgZW50cnk6IFwibW9uYWNvLXlhbWwveWFtbC53b3JrZXJcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgXSxcbiAgICAgIGdsb2JhbEFQSTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzdHJpcE1vbmFjb0lubGluZVNjcmlwdCgpLFxuICBdLFxuICBzZXJ2ZXI6IHtcbiAgICBwcm94eToge1xuICAgICAgLy8gVGhlIGkzWCBFeHBsb3JlciBoYXMgaXRzIG93biBkZXYgc2VydmVyIChucG0gcnVuXG4gICAgICAvLyBkZXY6aTN4LWV4cGxvcmVyKTsgdGhlIEV4cGxvcmVyIHBhZ2UgZnJhbWVzIGl0IGZyb20gaGVyZS5cbiAgICAgICcvaTN4LWV4cGxvcmVyLyc6IHsgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo1MTc0Jywgd3M6IHRydWUgfSxcbiAgICB9LFxuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogc3JjKCcnKSxcbiAgICAgICdAY29tcG9uZW50cyc6IHNyYygnY29tcG9uZW50cycpLFxuICAgICAgJ0B1dGlscyc6IHNyYygndXRpbHMnKSxcbiAgICAgICdAY29tcG9zYWJsZXMnOiBzcmMoJ2NvbXBvc2FibGVzJyksXG4gICAgICAnQHBhZ2VzJzogc3JjKCdwYWdlcycpLFxuICAgICAgJ0BzdG9yZSc6IHNyYygnc3RvcmUnKSxcbiAgICAgICdnb3QnOiBFTVBUWSxcbiAgICAgICdnb3QtZmV0Y2gnOiBFTVBUWSxcbiAgICAgICdnc3NhcGkuanMnOiBFTVBUWSxcbiAgICAgICdAYW1yYy1mYWN0b3J5cGx1cy9nc3NhcGknOiBFTVBUWSxcbiAgICAgICdwYXRoJzogJ3BhdGgtYnJvd3NlcmlmeScsXG4gICAgICAnYnVmZmVyJzogJ2J1ZmZlci8nLFxuICAgIH0sXG4gICAgcHJlc2VydmVTeW1saW5rczogdHJ1ZSxcbiAgfVxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFJQSxTQUFTLGVBQWUsV0FBVztBQUNuQyxZQUFZLFlBQVk7QUFFeEIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxTQUFTO0FBQ2hCLE9BQU8saUJBQWlCO0FBQ3hCLE9BQU8sbUJBQW1CO0FBQzFCLE9BQU8sYUFBYTtBQUNwQixPQUFPLFlBQVk7QUFDbkIsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sMkJBQTJCO0FBZGxDLElBQU0sbUNBQW1DO0FBQXlKLElBQU0sMkNBQTJDO0FBaUJuUCxJQUFNLFFBQVEsS0FBSyxRQUFRLGtDQUFXLGtCQUFrQjtBQUN4RCxJQUFNLE1BQU0sT0FBSyxjQUFjLElBQUksSUFBSSxTQUFTLENBQUMsSUFBSSx3Q0FBZSxDQUFDO0FBZ0JyRSxTQUFTLDBCQUEyQjtBQUNsQyxRQUFNLFNBQVM7QUFDZixTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsSUFDVCxtQkFBb0IsTUFBTTtBQUN4QixZQUFNLEtBQUs7QUFDWCxVQUFJLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRztBQUNsQixjQUFNLElBQUk7QUFBQSxVQUNSLHdEQUF3RCxNQUFNO0FBQUEsUUFHTDtBQUFBLE1BQzdEO0FBQ0EsYUFBTyxLQUFLLFFBQVEsSUFBSSxFQUFFO0FBQUEsSUFDNUI7QUFBQSxFQUNGO0FBQ0Y7QUFHQSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixRQUFRO0FBQUEsSUFDTjtBQUFBLElBQ0EsUUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLFdBQVc7QUFBQSxJQUNYLGVBQWU7QUFBQSxNQUNiLFdBQVc7QUFBQSxJQUNiO0FBQUEsSUFDQSxpQkFBaUI7QUFBQSxNQUNmLGdCQUFnQjtBQUFBLE1BQ2hCLHlCQUF5QjtBQUFBLElBQzNCO0FBQUEsRUFDRjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLFFBQVE7QUFBQSxJQUNsQixnQkFBZ0I7QUFBQSxNQUNkLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsY0FBYyxLQUFLO0FBQUEsTUFDakIsS0FBSztBQUFBLE1BQ0wsU0FBUztBQUFBLE1BQ1QsT0FBTyxDQUFDLGFBQWE7QUFBQTtBQUFBLElBQ3ZCLENBQUM7QUFBQSxJQUNELElBQUk7QUFBQSxNQUNGLFFBQVE7QUFBQSxRQUNOLElBQUk7QUFBQSxVQUNGLFdBQVcsTUFBTTtBQUNmLG1CQUFjLGtCQUFXLElBQUk7QUFBQSxVQUMvQjtBQUFBLFVBQ0EsU0FBUyxNQUFNO0FBQ2IsbUJBQWMsb0JBQWEsTUFBTSxPQUFPO0FBQUEsVUFDMUM7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLElBQ0QsWUFBWTtBQUFBLElBQ1osT0FBTztBQUFBLE1BQ0wsUUFBUSxDQUFDLFVBQVUsUUFBUTtBQUFBLElBQzdCLENBQUM7QUFBQSxJQUNELHNCQUFzQjtBQUFBLE1BQ3BCLGlCQUFpQixDQUFDLHVCQUF1QixNQUFNO0FBQUEsTUFDL0MsZUFBZTtBQUFBLFFBQ2I7QUFBQSxVQUNFLE9BQU87QUFBQSxVQUNQLE9BQU87QUFBQSxVQUNQLFFBQVE7QUFBQSxZQUNOLElBQUk7QUFBQSxZQUNKLE9BQU87QUFBQSxVQUNUO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFdBQVc7QUFBQSxJQUNiLENBQUM7QUFBQSxJQUNELHdCQUF3QjtBQUFBLEVBQzFCO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixPQUFPO0FBQUE7QUFBQTtBQUFBLE1BR0wsa0JBQWtCLEVBQUUsUUFBUSx5QkFBeUIsSUFBSSxLQUFLO0FBQUEsSUFDaEU7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLElBQUksRUFBRTtBQUFBLE1BQ1gsZUFBZSxJQUFJLFlBQVk7QUFBQSxNQUMvQixVQUFVLElBQUksT0FBTztBQUFBLE1BQ3JCLGdCQUFnQixJQUFJLGFBQWE7QUFBQSxNQUNqQyxVQUFVLElBQUksT0FBTztBQUFBLE1BQ3JCLFVBQVUsSUFBSSxPQUFPO0FBQUEsTUFDckIsT0FBTztBQUFBLE1BQ1AsYUFBYTtBQUFBLE1BQ2IsYUFBYTtBQUFBLE1BQ2IsNEJBQTRCO0FBQUEsTUFDNUIsUUFBUTtBQUFBLE1BQ1IsVUFBVTtBQUFBLElBQ1o7QUFBQSxJQUNBLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
