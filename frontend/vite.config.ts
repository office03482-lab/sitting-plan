import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";

    return {
      plugins: [react()],
      build: {
        sourcemap: false,
        chunkSizeWarningLimit: 700,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes("node_modules")) {
                return undefined;
              }
              if (id.includes("react-router-dom")) {
                return "router";
              }
              if (id.includes("@supabase") || id.includes("axios")) {
                return "data";
              }
              if (id.includes("react-dnd")) {
                return "dnd";
              }
              if (id.includes("lucide-react")) {
                return "icons";
              }
              return "vendor";
            },
          },
        },
      },
      resolve: {
        alias: {
        "@": path.resolve(__dirname, "./src"),
        "@lib": path.resolve(__dirname, "./src/lib"),
        "@pages": path.resolve(__dirname, "./src/pages"),
        "@store": path.resolve(__dirname, "./src/store"),
        "@services": path.resolve(__dirname, "./src/services"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@types": path.resolve(__dirname, "./src/types"),
        "@utils": path.resolve(__dirname, "./src/utils"),
        "@hooks": path.resolve(__dirname, "./src/hooks"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
