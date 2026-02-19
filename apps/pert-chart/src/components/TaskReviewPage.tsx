import { useState, useMemo } from 'react';
import type { PertTask } from '../logic/pert';
import { ChevronDown, ChevronRight, Trash2, Plus, Check, Edit2 } from 'lucide-react';

interface TaskReviewPageProps {
    tasks: PertTask[];
    onConfirm: (tasks: PertTask[]) => void;
    onCancel: () => void;
}

export default function TaskReviewPage({ tasks: initialTasks, onConfirm, onCancel }: TaskReviewPageProps) {
    const [tasks, setTasks] = useState<PertTask[]>(initialTasks);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Uncategorized']));
    const [editingId, setEditingId] = useState<string | null>(null);

    // Group tasks by category
    const tasksByCategory = useMemo(() => {
        const grouped: Record<string, PertTask[]> = {};
        tasks.forEach(task => {
            const cat = task.category || 'Uncategorized';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(task);
        });
        return grouped;
    }, [tasks]);

    const categories = Object.keys(tasksByCategory).sort();

    const toggleCategory = (cat: string) => {
        setExpandedCategories(prev => {
            const newSet = new Set(prev);
            if (newSet.has(cat)) newSet.delete(cat);
            else newSet.add(cat);
            return newSet;
        });
    };

    const updateTask = (id: string, field: keyof PertTask, value: string | number | string[]) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
    };

    const deleteTask = (id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id));
    };

    const addTask = (category: string) => {
        const newTask: PertTask = {
            id: Math.random().toString(36).substring(2, 11),
            name: 'New Task',
            optimistic: 1,
            likely: 2,
            pessimistic: 4,
            dependencies: [],
            category
        };
        setTasks(prev => [...prev, newTask]);
        setEditingId(newTask.id);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'var(--bg-app)',
            zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{
                padding: '24px 32px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px', color: 'var(--text-main)' }}>Review Tasks</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '14px' }}>
                        {tasks.length} tasks in {categories.length} categories
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '10px 20px', borderRadius: '8px',
                            background: 'var(--bg-node)', color: 'var(--text-muted)',
                            border: 'none', cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(tasks)}
                        style={{
                            padding: '10px 24px', borderRadius: '8px',
                            background: 'var(--accent-primary)', color: 'white',
                            border: 'none', cursor: 'pointer', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                    >
                        <Check size={18} />
                        Build Chart
                    </button>
                </div>
            </div>

            {/* Task List */}
            <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
                {categories.map(category => (
                    <div key={category} style={{ marginBottom: '24px' }}>
                        {/* Category Header */}
                        <div
                            onClick={() => toggleCategory(category)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '12px 16px', background: 'var(--bg-panel)',
                                borderRadius: '8px', cursor: 'pointer',
                                border: '1px solid var(--border-color)'
                            }}
                        >
                            {expandedCategories.has(category) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{category}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: 'auto' }}>
                                {tasksByCategory[category].length} tasks
                            </span>
                        </div>

                        {/* Tasks in Category */}
                        {expandedCategories.has(category) && (
                            <div style={{ marginTop: '8px', marginLeft: '16px' }}>
                                {tasksByCategory[category].map(task => (
                                    <div
                                        key={task.id}
                                        style={{
                                            padding: '12px 16px',
                                            background: editingId === task.id ? 'var(--bg-panel)' : 'var(--bg-node)',
                                            borderRadius: '8px', marginBottom: '8px',
                                            border: editingId === task.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            {editingId === task.id ? (
                                                <input
                                                    value={task.name}
                                                    onChange={e => updateTask(task.id, 'name', e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                                                    autoFocus
                                                    style={{
                                                        flex: 1, background: 'var(--bg-app)',
                                                        border: '1px solid var(--border-color)',
                                                        padding: '6px 10px', borderRadius: '4px',
                                                        color: 'var(--text-main)', fontSize: '14px'
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            ) : (
                                                <span
                                                    style={{ flex: 1, color: 'var(--text-main)', cursor: 'pointer' }}
                                                    onClick={() => setEditingId(task.id)}
                                                >
                                                    {task.name}
                                                </span>
                                            )}

                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                                                    O: {task.optimistic} | M: {task.likely} | P: {task.pessimistic}
                                                </span>
                                                <button
                                                    onClick={() => setEditingId(editingId === task.id ? null : task.id)}
                                                    style={{
                                                        background: editingId === task.id ? 'var(--accent-primary)' : 'transparent',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        padding: '4px',
                                                        borderRadius: '4px'
                                                    }}
                                                >
                                                    <Edit2 size={14} color={editingId === task.id ? 'white' : 'var(--text-muted)'} />
                                                </button>
                                                <button
                                                    onClick={() => deleteTask(task.id)}
                                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                                                >
                                                    <Trash2 size={14} color="var(--accent-critical)" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded Edit View */}
                                        {editingId === task.id && (
                                            <div style={{ marginTop: '12px' }}>
                                                {/* Time Estimates Row */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                                                    <div>
                                                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Optimistic</label>
                                                        <input
                                                            type="number"
                                                            value={task.optimistic}
                                                            onChange={e => updateTask(task.id, 'optimistic', Number(e.target.value))}
                                                            style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px', color: 'white' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Most Likely</label>
                                                        <input
                                                            type="number"
                                                            value={task.likely}
                                                            onChange={e => updateTask(task.id, 'likely', Number(e.target.value))}
                                                            style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px', color: 'white' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Pessimistic</label>
                                                        <input
                                                            type="number"
                                                            value={task.pessimistic}
                                                            onChange={e => updateTask(task.id, 'pessimistic', Number(e.target.value))}
                                                            style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px', color: 'white' }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Dependencies Section */}
                                                <div>
                                                    <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                                                        Dependencies (Tasks that must complete before this one)
                                                    </label>

                                                    {tasks.filter(t => t.id !== task.id).length === 0 ? (
                                                        <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
                                                            No other tasks available
                                                        </div>
                                                    ) : (
                                                        <div style={{
                                                            maxHeight: '200px',
                                                            overflowY: 'auto',
                                                            background: 'var(--bg-app)',
                                                            border: '1px solid var(--border-color)',
                                                            borderRadius: '6px',
                                                            padding: '8px'
                                                        }}>
                                                            {tasks.filter(t => t.id !== task.id).map(otherTask => {
                                                                const isDependent = task.dependencies.includes(otherTask.id);
                                                                return (
                                                                    <label
                                                                        key={otherTask.id}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                            padding: '6px 8px',
                                                                            cursor: 'pointer',
                                                                            borderRadius: '4px',
                                                                            background: isDependent ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                                                                            marginBottom: '4px'
                                                                        }}
                                                                        onMouseEnter={e => {
                                                                            if (!isDependent) {
                                                                                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                                                            }
                                                                        }}
                                                                        onMouseLeave={e => {
                                                                            if (!isDependent) {
                                                                                e.currentTarget.style.background = 'transparent';
                                                                            }
                                                                        }}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isDependent}
                                                                            onChange={e => {
                                                                                const newDeps = e.target.checked
                                                                                    ? [...task.dependencies, otherTask.id]
                                                                                    : task.dependencies.filter(id => id !== otherTask.id);
                                                                                updateTask(task.id, 'dependencies', newDeps);
                                                                            }}
                                                                            style={{ cursor: 'pointer' }}
                                                                        />
                                                                        <div style={{ flex: 1 }}>
                                                                            <div style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                                                                                {otherTask.name}
                                                                            </div>
                                                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                                                ID: {otherTask.id} • {otherTask.category || 'Uncategorized'}
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    {task.dependencies.length === 0 && (
                                                        <div style={{
                                                            marginTop: '8px',
                                                            padding: '8px 12px',
                                                            background: 'rgba(34, 197, 94, 0.1)',
                                                            border: '1px solid rgba(34, 197, 94, 0.3)',
                                                            borderRadius: '4px',
                                                            fontSize: '11px',
                                                            color: 'rgb(34, 197, 94)'
                                                        }}>
                                                            ✓ This task has no dependencies and can start immediately
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Add Task Button */}
                                <button
                                    onClick={() => addTask(category)}
                                    style={{
                                        width: '100%', padding: '10px',
                                        background: 'transparent', border: '1px dashed var(--border-color)',
                                        borderRadius: '8px', color: 'var(--text-muted)',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '6px'
                                    }}
                                >
                                    <Plus size={16} /> Add Task to {category}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
