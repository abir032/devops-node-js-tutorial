import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend's CORS only allows http://localhost:8081, so the dev server runs there.
export default defineConfig({
  plugins: [react()],
  server: { port: 8081, strictPort: true },
  preview: { port: 8081, strictPort: true }
});
