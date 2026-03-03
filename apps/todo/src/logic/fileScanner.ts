/**
 * Logic for scanning local directories using the File System Access API.
 */

export interface ProjectContext {
    structure: string[];
    fileContents: Record<string, string>;
}

const INTERESTING_FILES = [
    'package.json',
    'README.md',
    'todo.txt',
    'spec.md',
    'design.md',
    'requirements.txt',
    'index.html'
];

/**
 * Request directory permission and scan it.
 */
export async function scanDirectory(): Promise<ProjectContext> {
    // @ts-ignore - File System Access API types might not be in standard TS yet
    const dirHandle = await window.showDirectoryPicker();
    const context: ProjectContext = {
        structure: [],
        fileContents: {}
    };

    await processHandle(dirHandle, '', context);
    return context;
}

async function processHandle(
    handle: any,
    path: string,
    context: ProjectContext,
    depth: number = 0
) {
    // Limit depth to avoid massive projects crashing things
    if (depth > 5) return;

    for await (const [name, entry] of handle.entries()) {
        const fullPath = path ? `${path}/${name}` : name;

        if (entry.kind === 'directory') {
            // Skip hidden folders and node_modules
            if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
            context.structure.push(fullPath + '/');
            await processHandle(entry, fullPath, context, depth + 1);
        } else {
            context.structure.push(fullPath);

            // If it's an "interesting" file, read its content
            if (INTERESTING_FILES.includes(name.toLowerCase()) || name.endsWith('.md')) {
                const file = await entry.getFile();
                const content = await file.text();
                // Limit content size to avoid context window explosion
                context.fileContents[fullPath] = content.slice(0, 5000);
            }
        }
    }
}
