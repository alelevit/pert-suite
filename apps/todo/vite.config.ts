import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Deduplicate React — force all deps to use the same React instance
            'react': path.resolve('/Users/alexlevit/.gemini/antigravity/scratch/node_modules/react'),
            'react-dom': path.resolve('/Users/alexlevit/.gemini/antigravity/scratch/node_modules/react-dom'),
            // PERT dependencies installed in /tmp due to sandbox restrictions
            '@xyflow/react': path.resolve('/tmp/pert-install/node_modules/@xyflow/react'),
            '@xyflow/system': path.resolve('/tmp/pert-install/node_modules/@xyflow/system'),
            'dagre': path.resolve('/tmp/pert-install/node_modules/dagre'),
            'uuid': path.resolve('/tmp/pert-install/node_modules/uuid'),
            'reactflow': path.resolve('/tmp/pert-install/node_modules/reactflow'),
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
