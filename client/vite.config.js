import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
    server: {
    host: '0.0.0.0', // Binds to all network interfaces, accessible from other devices
    port: 5173, // Default port, can be changed
  }
})
