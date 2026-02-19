import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Save, Trash2, Download, Upload, X, Edit2, Check, Plus, Clock, Loader } from 'lucide-react';
import type { PertTask } from '../logic/pert';
import type { SavedProject } from '../services/projectStorage';
import {
    apiGetAllProjects,
    apiCreateProject,
    apiLoadProject,
    apiDeleteProject,
    apiRenameProject,
    apiImportProject,
} from '../services/projectApi';

interface ProjectManagerProps {
    currentTasks: PertTask[];
    currentDescription: string;
    onLoadProject: (tasks: PertTask[], description: string, projectId: string, projectName: string) => void;
    onClose: () => void;
}

export default function ProjectManager({
    currentTasks,
    currentDescription,
    onLoadProject,
    onClose
}: ProjectManagerProps) {
    const [projects, setProjects] = useState<SavedProject[]>([]);
    const [saveName, setSaveName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showSaveNew, setShowSaveNew] = useState(false);
    const [loading, setLoading] = useState(true);

    const refreshProjects = useCallback(async () => {
        try {
            const data = await apiGetAllProjects();
            setProjects(data);
        } catch (e) {
            console.error('Failed to load projects:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshProjects();
    }, [refreshProjects]);

    const handleSaveNew = async () => {
        if (!saveName.trim()) return;
        try {
            const saved = await apiCreateProject({
                name: saveName.trim(),
                description: currentDescription,
                tasks: currentTasks
            });
            await refreshProjects();
            setSaveName('');
            setShowSaveNew(false);
            alert(`Project "${saved.name}" saved!`);
        } catch (e) {
            alert(`Failed to save project: ${e}`);
        }
    };

    const handleLoad = async (id: string) => {
        const project = await apiLoadProject(id);
        if (project) {
            onLoadProject(project.tasks as PertTask[], project.description, project.id, project.name);
            onClose();
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (confirm(`Delete project "${name}"? This cannot be undone.`)) {
            await apiDeleteProject(id);
            await refreshProjects();
        }
    };

    const handleRename = async (id: string) => {
        if (!editName.trim()) return;
        await apiRenameProject(id, editName.trim());
        await refreshProjects();
        setEditingId(null);
        setEditName('');
    };

    const handleExport = (project: SavedProject) => {
        const json = JSON.stringify(project, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.pert.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.pert.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const text = await file.text();
            try {
                const data = JSON.parse(text);
                const imported = await apiImportProject(data);
                if (imported) {
                    await refreshProjects();
                    alert(`Project "${imported.name}" imported!`);
                } else {
                    alert('Failed to import project. Invalid format.');
                }
            } catch {
                alert('Failed to import project. Invalid JSON.');
            }
        };
        input.click();
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px'
        }}>
            <div style={{
                background: 'var(--bg-panel)',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                width: '100%',
                maxWidth: '700px',
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <FolderOpen size={24} color="var(--accent-primary)" />
                        <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-main)' }}>
                            Project Manager
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px'
                        }}
                    >
                        <X size={20} color="var(--text-muted)" />
                    </button>
                </div>

                {/* Actions Bar */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: '12px',
                    flexWrap: 'wrap'
                }}>
                    {showSaveNew ? (
                        <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
                            <input
                                value={saveName}
                                onChange={e => setSaveName(e.target.value)}
                                placeholder="Enter project name..."
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleSaveNew()}
                                style={{
                                    flex: 1,
                                    background: 'var(--bg-app)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    padding: '8px 12px',
                                    color: 'var(--text-main)',
                                    fontSize: '14px'
                                }}
                            />
                            <button
                                onClick={handleSaveNew}
                                disabled={!saveName.trim()}
                                style={{
                                    background: 'var(--accent-primary)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    color: 'white',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    opacity: saveName.trim() ? 1 : 0.5
                                }}
                            >
                                <Check size={16} /> Save
                            </button>
                            <button
                                onClick={() => { setShowSaveNew(false); setSaveName(''); }}
                                style={{
                                    background: 'var(--bg-node)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 12px',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => setShowSaveNew(true)}
                                style={{
                                    background: 'var(--accent-primary)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '10px 16px',
                                    color: 'white',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontWeight: 500
                                }}
                            >
                                <Save size={16} /> Save Current Project
                            </button>
                            <button
                                onClick={handleImport}
                                style={{
                                    background: 'var(--bg-node)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    padding: '10px 16px',
                                    color: 'var(--text-main)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                            >
                                <Upload size={16} /> Import JSON
                            </button>
                        </>
                    )}
                </div>

                {/* Project List */}
                <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                    {loading ? (
                        <div style={{
                            textAlign: 'center',
                            padding: '48px 24px',
                            color: 'var(--text-muted)'
                        }}>
                            <Loader size={32} style={{ opacity: 0.5, marginBottom: '16px', animation: 'spin 1s linear infinite' }} />
                            <p style={{ margin: 0, fontSize: '14px' }}>Loading projects...</p>
                        </div>
                    ) : projects.length === 0 ? (
                        <div style={{
                            textAlign: 'center',
                            padding: '48px 24px',
                            color: 'var(--text-muted)'
                        }}>
                            <FolderOpen size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                            <p style={{ margin: 0, fontSize: '16px' }}>No saved projects yet</p>
                            <p style={{ margin: '8px 0 0', fontSize: '14px', opacity: 0.7 }}>
                                Save your current project to get started
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {projects.map(project => (
                                <div
                                    key={project.id}
                                    style={{
                                        background: 'var(--bg-node)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        padding: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '16px'
                                    }}
                                >
                                    {/* Project Info */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        {editingId === project.id ? (
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <input
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleRename(project.id)}
                                                    autoFocus
                                                    style={{
                                                        flex: 1,
                                                        background: 'var(--bg-app)',
                                                        border: '1px solid var(--accent-primary)',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        color: 'var(--text-main)',
                                                        fontSize: '14px'
                                                    }}
                                                />
                                                <button
                                                    onClick={() => handleRename(project.id)}
                                                    style={{
                                                        background: 'var(--accent-primary)',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <Check size={14} color="white" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div
                                                style={{
                                                    fontSize: '15px',
                                                    fontWeight: 500,
                                                    color: 'var(--text-main)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}
                                            >
                                                {project.name}
                                            </div>
                                        )}
                                        <div style={{
                                            fontSize: '12px',
                                            color: 'var(--text-muted)',
                                            marginTop: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span>{project.tasks.length} tasks</span>
                                            <span>•</span>
                                            <Clock size={12} />
                                            <span>{formatDate(project.updatedAt)}</span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            onClick={() => handleLoad(project.id)}
                                            style={{
                                                background: 'var(--accent-primary)',
                                                border: 'none',
                                                borderRadius: '6px',
                                                padding: '8px 16px',
                                                color: 'white',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontSize: '13px'
                                            }}
                                        >
                                            <Plus size={14} /> Load
                                        </button>
                                        <button
                                            onClick={() => { setEditingId(project.id); setEditName(project.name); }}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '8px'
                                            }}
                                            title="Rename"
                                        >
                                            <Edit2 size={16} color="var(--text-muted)" />
                                        </button>
                                        <button
                                            onClick={() => handleExport(project)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '8px'
                                            }}
                                            title="Export JSON"
                                        >
                                            <Download size={16} color="var(--text-muted)" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(project.id, project.name)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '8px'
                                            }}
                                            title="Delete"
                                        >
                                            <Trash2 size={16} color="var(--accent-critical)" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
