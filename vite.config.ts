import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Preserve complete notices for the dependencies actually shipped in the viewer.
  // Worker-only QuickJS notices are copied separately from public/licenses.
  build: { license: { fileName: 'licenses/dependencies.md' } },
  // The bot referee runs in a module worker that loads QuickJS lazily.
  worker: { format: 'es' },
  // QuickJS finds its .wasm next to its own module; pre-bundling would move the module away.
  optimizeDeps: { exclude: ['@jitl/quickjs-wasmfile-release-sync'] },
})
