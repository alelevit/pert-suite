import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// Monorepo root — two levels up from apps/todo
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Deduplicate React — force all deps to use the same React instance
            'react': path.resolve(rootDir, 'node_modules/react'),
            'react-dom': path.resolve(rootDir, 'node_modules/react-dom'),
            // PERT dependencies — resolved via workspace hoisting in root node_modules
            '@xyflow/react': path.resolve(rootDir, 'node_modules/@xyflow/react'),
            '@xyflow/system': path.resolve(rootDir, 'node_modules/@xyflow/system'),
            'dagre': path.resolve(rootDir, 'node_modules/dagre'),
            'uuid': path.resolve(rootDir, 'node_modules/uuid'),
            'reactflow': path.resolve(rootDir, 'node_modules/reactflow'),
        },
    },
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
