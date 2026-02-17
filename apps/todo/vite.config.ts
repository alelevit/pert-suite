import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5176,
        proxy: {
            '/api': {
                target: 'https://pert-suite-server.onrender.com',
                changeOrigin: true,
            }
        }
    }
})
