import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.BACKEND_URL || "http://localhost:8000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        // Dev only: forward /api/* to FastAPI so no CORS setup is needed locally.
        "/api": { target: backend, changeOrigin: true },
      },
    },
  };
});
