import { useState, useEffect, useCallback, useRef } from 'react';
import type { TodoTask } from '@pert-suite/shared';
import { apiGetTodos, apiGetTodayTodos, apiGetUpcomingTodos, apiGetSections, apiCreateTodo, apiCompleteTodo, apiDeleteTodo, apiUpdateTodo, apiAnalyzeTodos, mockAnalyzeTodos } from './services/todoApi';
import { Sun, Inbox, Calendar, ChevronRight, ChevronDown, Plus, Check, Trash2, RotateCcw, Flag, Clock, Loader, Tag, X, Settings, Sparkles, Send, HelpCircle, Edit2, Menu } from 'lucide-react';

type View = 'today' | 'inbox' | 'upcoming' | 'all';

/* ─── Helpers ─── */

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getToday(): string {
    return new Date().toISOString().split('T')[0];
}

function getPriorityColor(p: string): string {
    if (p === 'p1') return 'var(--priority-p1)';
    if (p === 'p2') return 'var(--priority-p2)';
    if (p === 'p3') return 'var(--priority-p3)';
    return 'var(--text-faint)';
}

function getPriorityLabel(p: string): string {
    if (p === 'p1') return '🔴 P1';
    if (p === 'p2') return '🟡 P2';
    if (p === 'p3') return '🔵 P3';
    return 'No priority';
}

/* ─── Auto-Categorization Heuristic ─── */

const PERSONAL_KEYWORDS = ['kids', 'family', 'grocery', 'groceries', 'gym', 'doctor', 'dentist', 'pickup', 'pick up', 'laundry', 'cook', 'cooking', 'dog', 'cat', 'pet', 'school', 'homework', 'birthday', 'dinner', 'lunch', 'appointment', 'pharmacy', 'cleaning', 'home', 'garden', 'workout'];
const WORK_KEYWORDS = ['deploy', 'standup', 'stand-up', 'sprint', 'meeting', 'review', 'PR', 'merge', 'ticket', 'client', 'presentation', 'report', 'email', 'slack', 'jira', 'agile', 'scrum', 'deadline', 'release', 'code', 'bug', 'feature', 'design', 'server', 'api', 'database', 'test', 'staging', 'production'];

function guessSection(title: string): string | null {
    const lower = title.toLowerCase();
    const personalScore = PERSONAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const workScore = WORK_KEYWORDS.filter(kw => lower.includes(kw)).length;
    if (personalScore > workScore && personalScore > 0) return 'personal';
    if (workScore > personalScore && workScore > 0) return 'work';
    return null;
}

/* ─── Natural Language Date & Priority Parsing ─── */

const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
};

const DAY_NAMES: Record<string, number> = {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
};

interface ParsedInput {
    cleanTitle: string;
    detectedDate: string | null;
    detectedDateLabel: string | null;
    detectedPriority: 'p1' | 'p2' | 'p3' | null;
}

function parseNaturalInput(raw: string): ParsedInput {
    let text = raw;
    let detectedDate: string | null = null;
    let detectedDateLabel: string | null = null;
    let detectedPriority: 'p1' | 'p2' | 'p3' | null = null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Priority: match p1, p2, p3 as standalone tokens
    const prioMatch = text.match(/(?:^|\s)(p[123])(?:\s|$)/i);
    if (prioMatch) {
        detectedPriority = prioMatch[1].toLowerCase() as 'p1' | 'p2' | 'p3';
        text = text.replace(prioMatch[0], ' ').trim();
    }

    // "today" / "tod" — requires trailing space to avoid premature firing
    if (/(?:^|\s)(today|tod)(?=\s)/i.test(text)) {
        detectedDate = fmt(today);
        detectedDateLabel = 'Today';
        text = text.replace(/(?:^|\s)(today|tod)(?=\s)/i, ' ').trim();
    }
    // "tomorrow" / "tom" / "tmrw" / "tmr"
    else if (/(?:^|\s)(tomorrow|tom|tmrw|tmr)(?=\s)/i.test(text)) {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        detectedDate = fmt(d);
        detectedDateLabel = 'Tomorrow';
        text = text.replace(/(?:^|\s)(tomorrow|tom|tmrw|tmr)(?=\s)/i, ' ').trim();
    }
    // Day names: "monday", "wed", etc.
    else {
        for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
            const regex = new RegExp(`(?:^|\\s)(${name})(?=\\s)`, 'i');
            if (regex.test(text)) {
                const d = new Date(today);
                let diff = dayNum - d.getDay();
                if (diff <= 0) diff += 7; // always next occurrence
                d.setDate(d.getDate() + diff);
                detectedDate = fmt(d);
                detectedDateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                text = text.replace(regex, ' ').trim();
                break;
            }
        }
    }

    // Month + day: "jul 12", "january 5", "dec 25"
    // Requires digit FOLLOWED by whitespace or end — prevents premature match while still typing the day
    if (!detectedDate) {
        for (const [name, monthNum] of Object.entries(MONTHS)) {
            const regex = new RegExp(`(?:^|\\s)(${name})\\s+(\\d{1,2})(?=\\s)`, 'i');
            const m = text.match(regex);
            if (m) {
                const day = parseInt(m[2], 10);
                if (day < 1 || day > 31) continue; // sanity check
                const year = today.getFullYear();
                const d = new Date(year, monthNum, day);
                // If the date is in the past, use next year
                if (d < today) d.setFullYear(year + 1);
                detectedDate = fmt(d);
                detectedDateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
                text = text.replace(m[0], ' ').trim();
                break;
            }
        }
    }

    return {
        cleanTitle: text.replace(/\s+/g, ' ').trim(),
        detectedDate,
        detectedDateLabel,
        detectedPriority,
    };
}

function fmt(d: Date): string {
    return d.toISOString().split('T')[0];
}

/* ═══════════════════════════════════════════════════ */
/*                    MAIN APP                         */
/* ═══════════════════════════════════════════════════ */

function useIsMobile(breakpoint = 768) {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
    useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [breakpoint]);
    return isMobile;
}

function App() {
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [view, setView] = useState<View>('today');
    const [sectionFilter, setSectionFilter] = useState<string | null>(null);
    const [todos, setTodos] = useState<TodoTask[]>([]);
    const [allTodos, setAllTodos] = useState<TodoTask[]>([]);
    const [sections, setSections] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [lastCompleted, setLastCompleted] = useState<{ id: string; todo: TodoTask } | null>(null);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Quick add
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newSection, setNewSection] = useState('inbox');
    const [newPriority, setNewPriority] = useState<'p1' | 'p2' | 'p3' | 'none'>('none');
    const [newDueDate, setNewDueDate] = useState('');
    const [newRecurrence, setNewRecurrence] = useState('');
    const titleInputRef = useRef<HTMLInputElement>(null);

    // Parsed from natural language
    const [parsedInfo, setParsedInfo] = useState<ParsedInput>({ cleanTitle: '', detectedDate: null, detectedDateLabel: null, detectedPriority: null });

    // Auto-categorization
    const [suggestedSection, setSuggestedSection] = useState<string | null>(null);

    // Chat advisor
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Settings
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('todo_api_key') || '');
    const [llmModel, setLlmModel] = useState(() => localStorage.getItem('todo_llm_model') || 'gpt-4o');

    // Theme
    const [theme, setTheme] = useState(() => localStorage.getItem('pert_suite_theme') || 'midnight');

    // Hotkey cheat sheet
    const [showHotkeys, setShowHotkeys] = useState(false);

    /* ─── Apply Theme ─── */

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('pert_suite_theme', theme);
    }, [theme]);

    /* ─── Data Fetching ─── */

    const refreshTodos = useCallback(async () => {
        try {
            setLoading(true);
            let data: TodoTask[];
            if (sectionFilter) {
                data = await apiGetTodos({ section: sectionFilter, completed: false });
            } else {
                switch (view) {
                    case 'today':
                        data = await apiGetTodayTodos();
                        break;
                    case 'inbox':
                        data = await apiGetTodos({ section: 'inbox', completed: false });
                        break;
                    case 'upcoming':
                        data = await apiGetUpcomingTodos();
                        break;
                    default:
                        data = await apiGetTodos({ completed: false });
                }
            }
            setTodos(data);
            // Always fetch all todos for subtask parent→child mapping
            const all = await apiGetTodos();
            setAllTodos(all);
        } catch (e) {
            console.error('Failed to load todos:', e);
        } finally {
            setLoading(false);
        }
    }, [view, sectionFilter]);

    // Fetch sections
    useEffect(() => {
        apiGetSections().then(setSections).catch(console.error);
    }, [todos]);

    useEffect(() => {
        refreshTodos();
    }, [refreshTodos]);

    /* ─── Global Hotkeys ─── */

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

            if (isTyping) {
                // Only Escape works while typing
                if (e.key === 'Escape') {
                    if (quickAddOpen) { setQuickAddOpen(false); setNewTitle(''); return; }
                }
                return;
            }

            if (e.key === 'q') {
                e.preventDefault();
                setQuickAddOpen(true);
                setTimeout(() => titleInputRef.current?.focus(), 50);
            }
            if (e.key === '?') {
                e.preventDefault();
                setShowHotkeys(prev => !prev);
            }
            if (e.key === 'Escape') {
                if (showHotkeys) { setShowHotkeys(false); return; }
                if (settingsOpen) { setSettingsOpen(false); return; }
                if (chatOpen) { setChatOpen(false); return; }
                if (quickAddOpen) { setQuickAddOpen(false); setNewTitle(''); return; }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [quickAddOpen, chatOpen, settingsOpen, showHotkeys]);

    /* ─── Parse Natural Language Input ─── */

    useEffect(() => {
        if (!newTitle.trim()) {
            setParsedInfo({ cleanTitle: '', detectedDate: null, detectedDateLabel: null, detectedPriority: null });
            setSuggestedSection(null);
            return;
        }
        const timer = setTimeout(() => {
            const parsed = parseNaturalInput(newTitle);
            setParsedInfo(parsed);

            // Apply detected priority immediately
            if (parsed.detectedPriority) {
                setNewPriority(parsed.detectedPriority);
            }
            // Apply detected date immediately
            if (parsed.detectedDate) {
                setNewDueDate(parsed.detectedDate);
            }

            // Auto-categorize based on the clean title
            const guess = guessSection(parsed.cleanTitle || newTitle);
            if (guess && guess !== newSection) {
                setSuggestedSection(guess);
            } else {
                setSuggestedSection(null);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [newTitle, newSection]);

    /* ─── Handlers ─── */

    const handleAddTodo = async () => {
        const parsed = parseNaturalInput(newTitle);
        const title = parsed.cleanTitle || newTitle.trim();
        if (!title) return;

        const effectiveDueDate = parsed.detectedDate || newDueDate || undefined;
        const isFutureDue = effectiveDueDate && effectiveDueDate > getToday();

        const todo: Partial<TodoTask> = {
            title,
            section: newSection,
            priority: parsed.detectedPriority || newPriority,
            scheduledDate: (view === 'today' && !isFutureDue) ? getToday() : undefined,
            dueDate: effectiveDueDate,
        };
        if (newRecurrence) {
            todo.recurrence = { pattern: newRecurrence as 'daily' | 'weekdays' | 'weekly' | 'monthly' };
        }
        await apiCreateTodo(todo);
        setNewTitle('');
        setNewPriority('none');
        setNewDueDate('');
        setNewRecurrence('');
        setSuggestedSection(null);
        setParsedInfo({ cleanTitle: '', detectedDate: null, detectedDateLabel: null, detectedPriority: null });
        setQuickAddOpen(false);
        await refreshTodos();
    };

    const handleComplete = async (id: string) => {
        // Save for undo
        const original = allTodos.find(t => t.id === id);
        if (original) {
            setLastCompleted({ id, todo: { ...original } });
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            undoTimerRef.current = setTimeout(() => setLastCompleted(null), 5000);
        }
        // Optimistic: immediately mark completed in BOTH state arrays
        const markCompleted = (t: TodoTask) =>
            t.id === id ? { ...t, completed: true, completedAt: Date.now() } : t;
        setAllTodos(prev => prev.map(markCompleted));
        setTodos(prev => prev.map(markCompleted));
        // Fire API in background, revert on failure
        apiCompleteTodo(id).catch(() => refreshTodos());
    };

    const handleUndo = () => {
        if (!lastCompleted) return;
        const { id, todo } = lastCompleted;
        // Optimistic: restore in BOTH state arrays
        setAllTodos(prev => prev.map(t => t.id === id ? todo : t));
        setTodos(prev => {
            // Re-insert the task if it was filtered out
            const exists = prev.some(t => t.id === id);
            if (exists) return prev.map(t => t.id === id ? todo : t);
            return [...prev, todo];
        });
        setLastCompleted(null);
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        // Fire API in background, then do a full refresh to fix ordering
        apiUpdateTodo(id, { completed: false, completedAt: undefined })
            .then(() => refreshTodos())
            .catch(() => refreshTodos());
    };

    const handleDelete = async (id: string) => {
        await apiDeleteTodo(id);
        await refreshTodos();
    };

    const handleUncomplete = async (id: string) => {
        await apiUpdateTodo(id, { completed: false, completedAt: undefined });
        await refreshTodos();
    };

    const handleCyclePriority = async (task: TodoTask) => {
        const cycle: Record<string, 'p1' | 'p2' | 'p3' | 'none'> = { none: 'p1', p1: 'p2', p2: 'p3', p3: 'none' };
        const next = cycle[task.priority] || 'none';
        await apiUpdateTodo(task.id, { priority: next });
        await refreshTodos();
    };

    const handleAddSubtask = async (parentId: string, title: string) => {
        const parent = allTodos.find(t => t.id === parentId);
        await apiCreateTodo({
            title,
            parentId,
            section: parent?.section || 'inbox',
            priority: 'none',
        });
        await refreshTodos();
    };

    /* ─── Chat Advisor ─── */

    const handleAdvisorOpen = async () => {
        setChatOpen(true);
        if (chatMessages.length === 0) {
            // Auto-analyze on open
            setChatLoading(true);
            try {
                const todayTasks = view === 'today' ? todos : await apiGetTodayTodos();
                let analysis: string;
                if (apiKey) {
                    analysis = await apiAnalyzeTodos(todayTasks, apiKey, llmModel);
                } else {
                    analysis = await mockAnalyzeTodos(todayTasks);
                }
                setChatMessages([{ role: 'ai', content: analysis }]);
            } catch (err: any) {
                setChatMessages([{ role: 'ai', content: `⚠️ Error: ${err.message}. ${!apiKey ? 'Configure your API key in settings (⚙️) for real AI advice.' : ''}` }]);
            } finally {
                setChatLoading(false);
            }
        }
    };

    const handleChatSend = async () => {
        if (!chatInput.trim()) return;
        const userMsg = chatInput.trim();
        setChatInput('');
        setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setChatLoading(true);

        try {
            if (apiKey) {
                const analysis = await apiAnalyzeTodos(todos, apiKey, llmModel);
                setChatMessages(prev => [...prev, { role: 'ai', content: analysis }]);
            } else {
                const response = await mockAnalyzeTodos(todos);
                setChatMessages(prev => [...prev, { role: 'ai', content: response }]);
            }
        } catch (err: any) {
            setChatMessages(prev => [...prev, { role: 'ai', content: `⚠️ Error: ${err.message}` }]);
        } finally {
            setChatLoading(false);
        }
    };

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    /* ─── Save Settings ─── */

    const saveSettings = () => {
        localStorage.setItem('todo_api_key', apiKey);
        localStorage.setItem('todo_llm_model', llmModel);
        localStorage.setItem('pert_suite_theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        setSettingsOpen(false);
    };

    /* ─── Group tasks ─── */

    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    const recurring = activeTodos.filter(t => t.recurrence);
    const pertLinked = activeTodos.filter(t => !t.recurrence && t.pertProjectId);
    const regular = activeTodos.filter(t => !t.recurrence && !t.pertProjectId);

    const viewTitle = {
        today: 'Today',
        inbox: 'Inbox',
        upcoming: 'Upcoming',
        all: 'All Tasks',
    }[view];

    const viewIcon = {
        today: <Sun size={22} color="var(--accent-warning)" />,
        inbox: <Inbox size={22} color="var(--accent-primary)" />,
        upcoming: <Calendar size={22} color="var(--accent-success)" />,
        all: <ChevronRight size={22} color="var(--text-secondary)" />,
    }[view];

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
            {/* ══════════ Mobile Sidebar Backdrop ══════════ */}
            {isMobile && sidebarOpen && (
                <div className="mobile-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
            )}

            {/* ══════════ Sidebar ══════════ */}
            <nav
                className={isMobile ? `mobile-sidebar${sidebarOpen ? ' open' : ''}` : ''}
                style={{
                    width: 'var(--sidebar-width)',
                    background: 'var(--bg-panel)',
                    borderRight: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: isMobile ? 'calc(env(safe-area-inset-top) + 20px) 0 20px' : '20px 0',
                    flexShrink: 0,
                    ...(isMobile ? { height: '100%' } : {}),
                }}
            >
                {/* Logo */}
                <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '22px' }}>✅</span>
                        <span>Todo</span>
                    </h1>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>PERT Suite</p>
                </div>

                {/* Nav items */}
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {([
                        { id: 'today', label: 'Today', icon: <Sun size={18} />, color: 'var(--accent-warning)' },
                        { id: 'inbox', label: 'Inbox', icon: <Inbox size={18} />, color: 'var(--accent-primary)' },
                        { id: 'upcoming', label: 'Upcoming', icon: <Calendar size={18} />, color: 'var(--accent-success)' },
                        { id: 'all', label: 'All Tasks', icon: <ChevronRight size={18} />, color: 'var(--text-secondary)' },
                    ] as const).map(item => (
                        <button
                            key={item.id}
                            onClick={() => { setSectionFilter(null); setView(item.id); if (isMobile) setSidebarOpen(false); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                fontSize: '14px',
                                fontWeight: view === item.id ? 500 : 400,
                                color: view === item.id ? 'var(--text-main)' : 'var(--text-secondary)',
                                background: view === item.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                                transition: 'var(--transition-fast)',
                                width: '100%',
                                textAlign: 'left',
                            }}
                        >
                            <span style={{ color: item.color }}>{item.icon}</span>
                            {item.label}
                        </button>
                    ))}
                </div>

                {/* Sections */}
                <div style={{ marginTop: '24px', padding: '0 12px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '0 12px', marginBottom: '8px' }}>
                        Sections
                    </div>
                    <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                        {sections.filter(s => s !== 'inbox').map((section, i) => {
                            const colors = ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#818cf8', '#22d3ee', '#a3e635', '#e879f9'];
                            const isActive = sectionFilter === section;
                            const displayName = section.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            return (
                                <button
                                    key={section}
                                    onClick={() => {
                                        if (isActive) {
                                            setSectionFilter(null);
                                            setView('all');
                                        } else {
                                            setSectionFilter(section);
                                            if (isMobile) setSidebarOpen(false);
                                            setView('all');
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '8px 12px',
                                        borderRadius: '8px',
                                        fontSize: '13px',
                                        fontWeight: isActive ? 500 : 400,
                                        color: isActive ? 'var(--text-main)' : 'var(--text-secondary)',
                                        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                                        width: '100%',
                                        textAlign: 'left',
                                        transition: 'var(--transition-fast)',
                                    }}
                                >
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Keyboard Shortcuts Hint */}
                <div style={{ marginTop: 'auto', padding: '12px 20px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: 'var(--text-faint)' }}>
                    <span style={{ cursor: 'pointer' }} onClick={() => setShowHotkeys(true)}>
                        ⌨️ Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '3px', fontSize: '10px' }}>?</kbd> for shortcuts
                    </span>
                </div>
            </nav>

            {/* ══════════ Main Content ══════════ */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header */}
                <header style={{
                    height: 'var(--header-height)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: isMobile ? '0 16px' : '0 32px',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {isMobile && (
                            <button
                                onClick={() => setSidebarOpen(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '6px', borderRadius: '6px',
                                    background: 'rgba(255,255,255,0.06)',
                                    marginRight: '4px',
                                }}
                            >
                                <Menu size={20} />
                            </button>
                        )}
                        {viewIcon}
                        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>{viewTitle}</h2>
                        {view === 'today' && (
                            <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            {activeTodos.length} task{activeTodos.length !== 1 ? 's' : ''}
                        </span>
                        <button
                            onClick={handleAdvisorOpen}
                            title="Day Advisor"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '6px 14px', borderRadius: '8px', fontSize: '13px',
                                background: chatOpen ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                                color: chatOpen ? 'white' : 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                transition: 'var(--transition-fast)',
                                cursor: 'pointer',
                            }}
                        >
                            <Sparkles size={14} /> Advisor
                        </button>
                        <button
                            onClick={() => setSettingsOpen(true)}
                            title="Settings"
                            style={{
                                padding: '6px', borderRadius: '8px', color: 'var(--text-muted)',
                                background: 'transparent', cursor: 'pointer',
                            }}
                        >
                            <Settings size={18} />
                        </button>
                    </div>
                </header>

                {/* Task List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--text-muted)' }}>
                            <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
                            <span style={{ marginLeft: '12px' }}>Loading...</span>
                        </div>
                    ) : (
                        <>
                            {/* Today view with sections */}
                            {view === 'today' && recurring.length > 0 && (
                                <TaskGroup title="🔁 Daily" tasks={recurring} onComplete={handleComplete} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onAddSubtask={handleAddSubtask} allTasks={allTodos} showDate={false} onTaskClick={setSelectedTaskId} />
                            )}
                            {view === 'today' && pertLinked.length > 0 && (
                                <TaskGroup title="📋 From Projects" tasks={pertLinked} onComplete={handleComplete} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onAddSubtask={handleAddSubtask} allTasks={allTodos} showDate={false} onTaskClick={setSelectedTaskId} />
                            )}
                            {view === 'today' ? (
                                <TaskGroup title={recurring.length > 0 || pertLinked.length > 0 ? '✏️ Tasks' : ''} tasks={regular} onComplete={handleComplete} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onAddSubtask={handleAddSubtask} allTasks={allTodos} showDate={false} onTaskClick={setSelectedTaskId} />
                            ) : view === 'upcoming' ? (
                                <TaskGroup title="📅 Upcoming" tasks={activeTodos} onComplete={handleComplete} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onAddSubtask={handleAddSubtask} allTasks={allTodos} showDate onTaskClick={setSelectedTaskId} />
                            ) : (
                                <TaskGroup title="" tasks={activeTodos} onComplete={handleComplete} onDelete={handleDelete} onCyclePriority={handleCyclePriority} onAddSubtask={handleAddSubtask} allTasks={allTodos} showDate onTaskClick={setSelectedTaskId} />
                            )}

                            {/* Empty state */}
                            {activeTodos.length === 0 && !loading && (
                                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.4 }}>
                                        {view === 'today' ? '☀️' : view === 'inbox' ? '📥' : view === 'upcoming' ? '📅' : '📋'}
                                    </div>
                                    <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                                        {view === 'today' ? 'All clear for today!' : view === 'upcoming' ? 'No upcoming tasks' : 'No tasks here'}
                                    </p>
                                    <p style={{ fontSize: '13px' }}>Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>q</kbd> to add a task</p>
                                </div>
                            )}

                            {/* Completed section */}
                            {completedTodos.length > 0 && (
                                <CompletedSection tasks={completedTodos} onUncomplete={handleUncomplete} onDelete={handleDelete} />
                            )}
                        </>
                    )}
                </div>

                {/* Quick Add Bar */}
                <div style={{
                    borderTop: '1px solid var(--border-color)',
                    padding: '16px 32px',
                    background: 'var(--bg-panel)',
                    flexShrink: 0,
                }}>
                    {quickAddOpen ? (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    ref={titleInputRef}
                                    autoFocus
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && newTitle.trim()) handleAddTodo();
                                        if (e.key === 'Escape') { setQuickAddOpen(false); setNewTitle(''); setSuggestedSection(null); }
                                    }}
                                    placeholder="What needs to be done?"
                                    style={{
                                        flex: 1,
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color-hover)',
                                        borderRadius: '8px',
                                        padding: '10px 14px',
                                        fontSize: '14px',
                                        outline: 'none',
                                    }}
                                />
                                <button
                                    onClick={handleAddTodo}
                                    disabled={!newTitle.trim()}
                                    style={{
                                        background: 'var(--accent-primary)',
                                        color: 'white',
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        fontWeight: 500,
                                        fontSize: '13px',
                                        opacity: newTitle.trim() ? 1 : 0.5,
                                        transition: 'var(--transition-fast)',
                                    }}
                                >
                                    Add
                                </button>
                                <button
                                    onClick={() => { setQuickAddOpen(false); setNewTitle(''); setSuggestedSection(null); }}
                                    style={{ padding: '10px 14px', borderRadius: '8px', color: 'var(--text-muted)', background: 'var(--bg-input)' }}
                                >
                                    Cancel
                                </button>
                            </div>

                            {/* Detected tokens from natural language */}
                            {(parsedInfo.detectedDate || parsedInfo.detectedPriority) && (
                                <div className="fade-in" style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                                    padding: '6px 12px', borderRadius: '8px',
                                    background: 'rgba(56, 189, 248, 0.08)',
                                    border: '1px solid rgba(56, 189, 248, 0.15)',
                                    fontSize: '12px', color: '#7dd3fc',
                                }}>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Detected:</span>
                                    {parsedInfo.detectedDate && (
                                        <span style={{
                                            display: 'flex', alignItems: 'center', gap: '4px',
                                            background: 'rgba(56, 189, 248, 0.15)', padding: '2px 8px', borderRadius: '4px',
                                        }}>
                                            📅 {parsedInfo.detectedDateLabel}
                                            <button
                                                onClick={() => { setNewDueDate(''); setParsedInfo(p => ({ ...p, detectedDate: null, detectedDateLabel: null })); }}
                                                style={{ background: 'none', border: 'none', color: '#7dd3fc', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                                            >×</button>
                                        </span>
                                    )}
                                    {parsedInfo.detectedPriority && (
                                        <span style={{
                                            display: 'flex', alignItems: 'center', gap: '4px',
                                            background: 'rgba(56, 189, 248, 0.15)', padding: '2px 8px', borderRadius: '4px',
                                            color: getPriorityColor(parsedInfo.detectedPriority),
                                        }}>
                                            🚩 {parsedInfo.detectedPriority.toUpperCase()}
                                            <button
                                                onClick={() => { setNewPriority('none'); setParsedInfo(p => ({ ...p, detectedPriority: null })); }}
                                                style={{ background: 'none', border: 'none', color: '#7dd3fc', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                                            >×</button>
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Auto-categorization suggestion */}
                            {suggestedSection && (
                                <div className="fade-in" style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '6px 12px', borderRadius: '8px',
                                    background: 'rgba(139, 92, 246, 0.1)',
                                    border: '1px solid rgba(139, 92, 246, 0.2)',
                                    fontSize: '12px', color: '#a78bfa',
                                }}>
                                    <Sparkles size={12} />
                                    Looks like: {suggestedSection === 'personal' ? '🏠 Personal' : '💼 Work'}
                                    <button
                                        onClick={() => { setNewSection(suggestedSection); setSuggestedSection(null); }}
                                        style={{
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                                            background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa',
                                            cursor: 'pointer', border: 'none',
                                        }}
                                    >
                                        Accept
                                    </button>
                                    <button
                                        onClick={() => setSuggestedSection(null)}
                                        style={{
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                                            background: 'transparent', color: 'var(--text-faint)',
                                            cursor: 'pointer', border: 'none',
                                        }}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            )}

                            {/* Meta row */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select
                                    value={newSection}
                                    onChange={e => setNewSection(e.target.value)}
                                    style={{
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        padding: '6px 10px',
                                        fontSize: '12px',
                                        color: 'var(--text-secondary)',
                                        outline: 'none',
                                    }}
                                >
                                    <option value="inbox">📥 Inbox</option>
                                    <option value="personal">🏠 Personal</option>
                                    <option value="work">💼 Work</option>
                                </select>
                                {/* Priority with hotkey hints */}
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {(['p1', 'p2', 'p3', 'none'] as const).map((p, i) => (
                                        <button
                                            key={p}
                                            onClick={() => setNewPriority(p)}
                                            title={`${getPriorityLabel(p)} (⌘${i + 1})`}
                                            style={{
                                                padding: '4px 8px', borderRadius: '6px', fontSize: '12px',
                                                background: newPriority === p ? 'rgba(255,255,255,0.12)' : 'var(--bg-input)',
                                                border: newPriority === p ? `1px solid ${getPriorityColor(p)}` : '1px solid var(--border-color)',
                                                color: getPriorityColor(p),
                                                cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '4px',
                                            }}
                                        >
                                            <Flag size={10} />
                                            <span style={{ fontSize: '10px', opacity: 0.6 }}>{i + 1}</span>
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="date"
                                    value={newDueDate}
                                    onChange={e => setNewDueDate(e.target.value)}
                                    style={{
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        padding: '6px 10px',
                                        fontSize: '12px',
                                        color: 'var(--text-secondary)',
                                        outline: 'none',
                                    }}
                                />
                                <select
                                    value={newRecurrence}
                                    onChange={e => setNewRecurrence(e.target.value)}
                                    style={{
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        padding: '6px 10px',
                                        fontSize: '12px',
                                        color: newRecurrence ? 'var(--accent-success)' : 'var(--text-secondary)',
                                        outline: 'none',
                                    }}
                                >
                                    <option value="">No repeat</option>
                                    <option value="daily">🔁 Daily</option>
                                    <option value="weekdays">📅 Weekdays</option>
                                    <option value="weekly">📆 Weekly</option>
                                    <option value="monthly">🗓️ Monthly</option>
                                </select>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => { setQuickAddOpen(true); setTimeout(() => titleInputRef.current?.focus(), 50); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                width: '100%',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                color: 'var(--text-muted)',
                                fontSize: '14px',
                                transition: 'var(--transition-fast)',
                                border: '1px dashed var(--border-color)',
                            }}
                        >
                            <Plus size={18} color="var(--accent-primary)" />
                            Add task
                            <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.5 }}>
                                <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '3px' }}>q</kbd>
                            </span>
                        </button>
                    )}
                </div>
            </main>

            {/* ══════════ Floating Action Buttons ══════════ */}
            {!quickAddOpen && !selectedTaskId && (
                <>
                    {/* UNDO — lower left, shows for 5s after completing */}
                    {lastCompleted && (
                        <button
                            onClick={handleUndo}
                            className="fade-in"
                            style={{
                                position: 'fixed',
                                bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
                                left: '28px',
                                padding: '12px 20px',
                                borderRadius: '24px',
                                background: 'var(--accent-primary)',
                                color: 'white',
                                fontSize: '13px',
                                fontWeight: 600,
                                letterSpacing: '0.5px',
                                boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
                                cursor: 'pointer',
                                border: 'none',
                                zIndex: 50,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'transform 0.15s ease, opacity 0.15s ease',
                                WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            <RotateCcw size={14} />
                            UNDO
                        </button>
                    )}

                    {/* + ADD — lower right */}
                    <button
                        onClick={() => { setQuickAddOpen(true); setTimeout(() => titleInputRef.current?.focus(), 50); }}
                        style={{
                            position: 'fixed',
                            bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
                            right: '28px',
                            width: isMobile ? '64px' : '56px',
                            height: isMobile ? '64px' : '56px',
                            borderRadius: '50%',
                            background: 'var(--accent-primary)',
                            color: 'white',
                            fontSize: '28px',
                            fontWeight: 300,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 6px 24px rgba(99, 102, 241, 0.5)',
                            cursor: 'pointer',
                            border: 'none',
                            zIndex: 50,
                            transition: 'transform 0.15s ease',
                            WebkitTapHighlightColor: 'transparent',
                            touchAction: 'manipulation',
                        }}
                    >
                        <Plus size={isMobile ? 32 : 28} />
                    </button>
                </>
            )}

            {/* ══════════ Task Detail Panel ══════════ */}
            {selectedTaskId && (() => {
                const task = allTodos.find(t => t.id === selectedTaskId);
                if (!task) return null;
                return (
                    <TaskDetailPanel
                        task={task}
                        allTodos={allTodos}
                        sections={sections}
                        onClose={() => setSelectedTaskId(null)}
                        onUpdate={async (updates) => {
                            await apiUpdateTodo(task.id, updates);
                            await refreshTodos();
                        }}
                        onComplete={async () => {
                            await handleComplete(task.id);
                            setSelectedTaskId(null);
                        }}
                        onDelete={async () => {
                            await handleDelete(task.id);
                            setSelectedTaskId(null);
                        }}
                        onAddSubtask={async (title: string) => {
                            await handleAddSubtask(task.id, title);
                        }}
                        onSubtaskComplete={handleComplete}
                        onSubtaskDelete={handleDelete}
                    />
                );
            })()}

            {/* ══════════ Chat Advisor Drawer ══════════ */}
            {chatOpen && (
                <aside
                    className={isMobile ? 'mobile-overlay-panel' : ''}
                    style={{
                        width: isMobile ? '100%' : '360px',
                        background: 'var(--bg-panel)',
                        borderLeft: isMobile ? 'none' : '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        flexShrink: 0,
                    }}
                >
                    {/* Header */}
                    <div style={{
                        height: 'var(--header-height)',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 16px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                            <Sparkles size={18} color="var(--accent-primary)" />
                            Day Advisor
                        </div>
                        <button onClick={() => setChatOpen(false)} style={{ padding: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            <X size={18} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {chatMessages.length === 0 && !chatLoading && (
                            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                                <Sparkles size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                                <p style={{ fontSize: '14px', marginBottom: '8px' }}>Day Advisor</p>
                                <p style={{ fontSize: '12px' }}>Analyzes your tasks and suggests optimizations</p>
                            </div>
                        )}
                        {chatMessages.map((msg, i) => (
                            <div key={i} style={{
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                                padding: '10px 14px',
                                borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                                background: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                                color: msg.role === 'user' ? 'white' : 'var(--text-main)',
                                fontSize: '13px',
                                lineHeight: '1.5',
                                whiteSpace: 'pre-wrap',
                            }}>
                                {msg.content}
                            </div>
                        ))}
                        {chatLoading && (
                            <div style={{ alignSelf: 'flex-start', padding: '10px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', fontSize: '13px', color: 'var(--text-muted)' }}>
                                <Loader size={14} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: '8px' }} />
                                Analyzing your tasks...
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Input */}
                    <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px 16px', display: 'flex', gap: '8px' }}>
                        <input
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleChatSend(); }}
                            placeholder="Ask the advisor..."
                            style={{
                                flex: 1,
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                fontSize: '13px',
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={handleChatSend}
                            disabled={!chatInput.trim() || chatLoading}
                            style={{
                                padding: '8px 12px', borderRadius: '8px',
                                background: 'var(--accent-primary)',
                                color: 'white', cursor: 'pointer',
                                opacity: chatInput.trim() && !chatLoading ? 1 : 0.4,
                            }}
                        >
                            <Send size={14} />
                        </button>
                    </div>
                </aside>
            )}

            {/* ══════════ Settings Modal ══════════ */}
            {settingsOpen && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 100,
                }} onClick={() => setSettingsOpen(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        background: 'var(--bg-panel)', borderRadius: '16px',
                        padding: '28px', width: '420px', maxWidth: '90vw',
                        border: '1px solid var(--border-color)',
                    }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Settings size={18} /> Settings
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Theme Picker */}
                            <div>
                                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', display: 'block' }}>
                                    Theme
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                    {[
                                        { id: 'midnight', label: 'Midnight', bg: '#0f172a', panel: '#1e293b', text: '#f1f5f9' },
                                        { id: 'antigravity', label: 'Antigravity', bg: '#1a1b26', panel: '#24283b', text: '#c0caf5' },
                                        { id: 'soft-light', label: 'Soft Light', bg: '#faf8f5', panel: '#f0ece6', text: '#1c1917' },
                                        { id: 'daylight', label: 'Daylight', bg: '#ffffff', panel: '#f8fafc', text: '#0f172a' },
                                    ].map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => setTheme(t.id)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '10px 12px', borderRadius: '10px',
                                                border: theme === t.id ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                                                background: theme === t.id ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                                cursor: 'pointer', transition: 'var(--transition-fast)',
                                            }}
                                        >
                                            {/* Color swatch */}
                                            <div style={{
                                                width: '32px', height: '32px', borderRadius: '8px',
                                                background: `linear-gradient(135deg, ${t.bg} 50%, ${t.panel} 50%)`,
                                                border: '1px solid rgba(128,128,128,0.2)',
                                                flexShrink: 0,
                                            }} />
                                            <div>
                                                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)', textAlign: 'left' }}>{t.label}</div>
                                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'left' }}>{t.bg}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }} />

                            <div>
                                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'block' }}>
                                    OpenAI API Key
                                </label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    style={{
                                        width: '100%', background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color)', borderRadius: '8px',
                                        padding: '10px 14px', fontSize: '13px', outline: 'none',
                                    }}
                                />
                                <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px' }}>
                                    Used for AI Day Advisor. Leave empty to use mock mode.
                                </p>
                            </div>
                            <div>
                                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'block' }}>
                                    Model
                                </label>
                                <select
                                    value={llmModel}
                                    onChange={e => setLlmModel(e.target.value)}
                                    style={{
                                        width: '100%', background: 'var(--bg-input)',
                                        border: '1px solid var(--border-color)', borderRadius: '8px',
                                        padding: '10px 14px', fontSize: '13px', outline: 'none',
                                    }}
                                >
                                    <option value="gpt-4o">GPT-4o</option>
                                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '24px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setSettingsOpen(false)}
                                style={{ padding: '8px 16px', borderRadius: '8px', color: 'var(--text-muted)', background: 'var(--bg-input)', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveSettings}
                                style={{ padding: '8px 16px', borderRadius: '8px', color: 'white', background: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 500 }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════ Hotkey Cheat Sheet Modal ══════════ */}
            {showHotkeys && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 100,
                }} onClick={() => setShowHotkeys(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        background: 'var(--bg-panel)', borderRadius: '16px',
                        padding: '28px', width: '380px', maxWidth: '90vw',
                        border: '1px solid var(--border-color)',
                    }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <HelpCircle size={18} /> Keyboard Shortcuts
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {[
                                ['q', 'Add new task'],
                                ['p1 / p2 / p3', 'Set priority (type inline)'],
                                ['today', 'Due today (type inline)'],
                                ['tomorrow', 'Due tomorrow (type inline)'],
                                ['wed, fri...', 'Due on a day (type inline)'],
                                ['jul 12', 'Due on a date (type inline)'],
                                ['Esc', 'Close / Cancel'],
                                ['?', 'Toggle this help'],
                                ['Enter', 'Submit task (in quick-add)'],
                            ].map(([key, desc]) => (
                                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{desc}</span>
                                    <kbd style={{
                                        background: 'rgba(255,255,255,0.08)', padding: '3px 8px',
                                        borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace',
                                        border: '1px solid var(--border-color)', color: 'var(--text-main)',
                                    }}>{key}</kbd>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowHotkeys(false)}
                            style={{ marginTop: '20px', width: '100%', padding: '8px', borderRadius: '8px', background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

/* ═══════════════════════════════════════════════════ */
/*                 TASK GROUP                          */
/* ═══════════════════════════════════════════════════ */

function TaskGroup({ title, tasks, onComplete, onDelete, onCyclePriority, onAddSubtask, allTasks, showDate, onTaskClick }: {
    title: string;
    tasks: TodoTask[];
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onCyclePriority: (task: TodoTask) => void;
    onAddSubtask: (parentId: string, title: string) => Promise<void>;
    allTasks: TodoTask[];
    showDate?: boolean;
    onTaskClick?: (id: string) => void;
}) {
    // Build parent→children map from ALL tasks
    const childrenMap = new Map<string, TodoTask[]>();
    for (const t of allTasks) {
        if (t.parentId) {
            const existing = childrenMap.get(t.parentId) || [];
            existing.push(t);
            childrenMap.set(t.parentId, existing);
        }
    }

    // Only show top-level tasks (not subtasks) from the filtered set
    const topLevel = tasks.filter(t => !t.parentId);

    if (topLevel.length === 0 && !title) return null;

    return (
        <div style={{ marginBottom: '24px' }}>
            {title && (
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                    {title}
                </h3>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {topLevel.map(task => (
                    <TaskItem
                        key={task.id}
                        task={task}
                        subtasks={childrenMap.get(task.id) || []}
                        onComplete={onComplete}
                        onDelete={onDelete}
                        onCyclePriority={onCyclePriority}
                        onAddSubtask={onAddSubtask}
                        showDate={showDate}
                        onTaskClick={onTaskClick}
                    />
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════ */
/*                 TASK ITEM                           */
/* ═══════════════════════════════════════════════════ */

function TaskItem({ task, subtasks, onComplete, onDelete, onCyclePriority, onAddSubtask, showDate, depth = 0, onTaskClick }: {
    task: TodoTask;
    subtasks: TodoTask[];
    onComplete: (id: string) => void;
    onDelete: (id: string) => void;
    onCyclePriority: (task: TodoTask) => void;
    onAddSubtask: (parentId: string, title: string) => Promise<void>;
    showDate?: boolean;
    depth?: number;
    onTaskClick?: (id: string) => void;
}) {
    const [hovering, setHovering] = useState(false);
    const [expanded, setExpanded] = useState(true);
    const [addingSubtask, setAddingSubtask] = useState(false);
    const [subtaskTitle, setSubtaskTitle] = useState('');
    const subtaskInputRef = useRef<HTMLInputElement>(null);

    const activeSubtasks = subtasks.filter(s => !s.completed);
    const completedSubtasks = subtasks.filter(s => s.completed);
    const hasSubtasks = subtasks.length > 0;

    const handleAddSubtask = async () => {
        if (!subtaskTitle.trim()) return;
        await onAddSubtask(task.id, subtaskTitle.trim());
        setSubtaskTitle('');
        setAddingSubtask(false);
        setExpanded(true);
    };

    return (
        <div className="fade-in">
            <div
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
                onClick={() => onTaskClick?.(task.id)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    paddingLeft: `${12 + depth * 28}px`,
                    borderRadius: '8px',
                    background: hovering ? 'var(--bg-card-hover)' : 'transparent',
                    transition: 'var(--transition-fast)',
                    cursor: 'pointer',
                }}
            >
                {/* Expand/collapse toggle for tasks with subtasks */}
                {hasSubtasks ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        style={{
                            width: '16px', height: '16px', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', padding: 0,
                            transition: 'transform 0.15s ease',
                            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        }}
                    >
                        <ChevronDown size={14} />
                    </button>
                ) : (
                    <span style={{ width: '16px', flexShrink: 0 }} />
                )}

                {/* Checkbox */}
                <button
                    onClick={(e) => { e.stopPropagation(); onComplete(task.id); }}
                    style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: `2px solid ${task.priority !== 'none' ? getPriorityColor(task.priority) : 'var(--text-faint)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'var(--transition-fast)',
                        background: hovering ? 'rgba(255,255,255,0.05)' : 'transparent',
                    }}
                >
                    {hovering && <Check size={12} color="var(--text-muted)" />}
                </button>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {task.title}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px', flexWrap: 'wrap' }}>
                        {/* Overdue / Due Today badge */}
                        {(() => {
                            if (!task.dueDate) return null;
                            const today = getToday();
                            const dueDateStr = task.dueDate;
                            if (dueDateStr < today) {
                                const diffMs = new Date(today).getTime() - new Date(dueDateStr).getTime();
                                const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                                return (
                                    <span style={{
                                        fontSize: '11px', fontWeight: 600,
                                        color: 'var(--accent-critical)',
                                        background: 'var(--accent-critical-soft)',
                                        padding: '1px 8px', borderRadius: '4px',
                                        display: 'flex', alignItems: 'center', gap: '3px',
                                    }}>
                                        ⚠️ {diffDays}d overdue
                                    </span>
                                );
                            } else if (dueDateStr === today) {
                                return (
                                    <span style={{
                                        fontSize: '11px', fontWeight: 500,
                                        color: 'var(--accent-warning)',
                                        background: 'rgba(245, 158, 11, 0.1)',
                                        padding: '1px 8px', borderRadius: '4px',
                                        display: 'flex', alignItems: 'center', gap: '3px',
                                    }}>
                                        📅 Due today
                                    </span>
                                );
                            }
                            return null;
                        })()}
                        {task.recurrence && (
                            <span style={{ fontSize: '11px', color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <RotateCcw size={10} /> {task.recurrence.pattern}
                            </span>
                        )}
                        {task.pertProjectName && (
                            <span style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <Tag size={10} /> {task.pertProjectName}
                            </span>
                        )}
                        {(task as any).durationDays && (
                            <span style={{ fontSize: '11px', color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
                                📐 {(task as any).durationDays}d
                            </span>
                        )}
                        {showDate && task.dueDate && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <Clock size={10} /> {formatDate(task.dueDate)}
                            </span>
                        )}
                        {showDate && task.scheduledDate && !task.dueDate && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <Calendar size={10} /> {formatDate(task.scheduledDate)}
                            </span>
                        )}
                        {task.section && task.section !== 'inbox' && (
                            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                                {task.section}
                            </span>
                        )}
                        {hasSubtasks && (
                            <span style={{
                                fontSize: '11px', color: 'var(--text-muted)',
                                display: 'flex', alignItems: 'center', gap: '3px',
                                background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '4px',
                            }}>
                                {completedSubtasks.length}/{subtasks.length}
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                {hovering && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setAddingSubtask(true); setExpanded(true); setTimeout(() => subtaskInputRef.current?.focus(), 50); }}
                        style={{ padding: '4px', borderRadius: '4px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        title="Add sub-task"
                    >
                        <Plus size={14} />
                    </button>
                )}
                {hovering && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
                        style={{ padding: '4px', borderRadius: '4px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                )}

                {/* Priority flag — clickable to cycle */}
                <button
                    onClick={(e) => { e.stopPropagation(); onCyclePriority(task); }}
                    title={`Priority: ${getPriorityLabel(task.priority)} — Click to change`}
                    style={{
                        padding: '4px', borderRadius: '4px', flexShrink: 0,
                        cursor: 'pointer', background: 'transparent', border: 'none',
                        opacity: task.priority !== 'none' ? 1 : (hovering ? 0.4 : 0),
                        transition: 'var(--transition-fast)',
                    }}
                >
                    <Flag size={14} color={getPriorityColor(task.priority)} />
                </button>
            </div>

            {/* Subtasks */}
            {expanded && hasSubtasks && (
                <div style={{ borderLeft: '2px solid var(--border-color)', marginLeft: `${28 + depth * 28}px` }}>
                    {activeSubtasks.map(sub => (
                        <TaskItem
                            key={sub.id}
                            task={sub}
                            subtasks={[]}
                            onComplete={onComplete}
                            onDelete={onDelete}
                            onCyclePriority={onCyclePriority}
                            onAddSubtask={onAddSubtask}
                            showDate={showDate}
                            depth={depth + 1}
                            onTaskClick={onTaskClick}
                        />
                    ))}
                    {completedSubtasks.length > 0 && (
                        <div style={{ padding: '4px 12px', paddingLeft: `${12 + (depth + 1) * 28}px`, fontSize: '11px', color: 'var(--text-faint)' }}>
                            {completedSubtasks.length} completed
                        </div>
                    )}
                </div>
            )}

            {/* Inline add subtask */}
            {addingSubtask && (
                <div style={{
                    display: 'flex', gap: '8px', alignItems: 'center',
                    padding: '6px 12px', paddingLeft: `${40 + depth * 28}px`,
                }} className="fade-in">
                    <input
                        ref={subtaskInputRef}
                        value={subtaskTitle}
                        onChange={e => setSubtaskTitle(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && subtaskTitle.trim()) handleAddSubtask();
                            if (e.key === 'Escape') { setAddingSubtask(false); setSubtaskTitle(''); }
                        }}
                        placeholder="Sub-task title..."
                        style={{
                            flex: 1,
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-color-hover)',
                            borderRadius: '6px',
                            padding: '6px 10px',
                            fontSize: '13px',
                            outline: 'none',
                        }}
                    />
                    <button
                        onClick={handleAddSubtask}
                        disabled={!subtaskTitle.trim()}
                        style={{
                            padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
                            background: 'var(--accent-primary)', color: 'white',
                            opacity: subtaskTitle.trim() ? 1 : 0.5,
                            border: 'none', cursor: 'pointer',
                        }}
                    >
                        Add
                    </button>
                    <button
                        onClick={() => { setAddingSubtask(false); setSubtaskTitle(''); }}
                        style={{ padding: '6px', borderRadius: '6px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════ */
/*              TASK DETAIL PANEL                      */
/* ═══════════════════════════════════════════════════ */

function TaskDetailPanel({ task, allTodos, sections, onClose, onUpdate, onComplete, onDelete, onAddSubtask, onSubtaskComplete, onSubtaskDelete }: {
    task: TodoTask;
    allTodos: TodoTask[];
    sections: string[];
    onClose: () => void;
    onUpdate: (updates: Partial<TodoTask>) => Promise<void>;
    onComplete: () => Promise<void>;
    onDelete: () => Promise<void>;
    onAddSubtask: (title: string) => Promise<void>;
    onSubtaskComplete: (id: string) => void;
    onSubtaskDelete: (id: string) => void;
}) {
    const [editTitle, setEditTitle] = useState(task.title);
    const [editDescription, setEditDescription] = useState(task.description || '');
    const [editDueDate, setEditDueDate] = useState(task.dueDate || '');
    const [editScheduledDate, setEditScheduledDate] = useState(task.scheduledDate || '');
    const [editPriority, setEditPriority] = useState(task.priority);
    const [editSection, setEditSection] = useState(task.section);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [showAddSubtask, setShowAddSubtask] = useState(false);
    const subtaskInputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Sync state when task changes
    useEffect(() => {
        setEditTitle(task.title);
        setEditDescription(task.description || '');
        setEditDueDate(task.dueDate || '');
        setEditScheduledDate(task.scheduledDate || '');
        setEditPriority(task.priority);
        setEditSection(task.section);
    }, [task.id, task.title, task.description, task.dueDate, task.scheduledDate, task.priority, task.section]);

    // Escape key to close
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const subtasks = allTodos.filter(t => t.parentId === task.id);
    const activeSubtasks = subtasks.filter(s => !s.completed);
    const completedSubtasks = subtasks.filter(s => s.completed);

    const handleAddSubtask = async () => {
        if (!newSubtaskTitle.trim()) return;
        await onAddSubtask(newSubtaskTitle.trim());
        setNewSubtaskTitle('');
    };

    const fieldLabelStyle: React.CSSProperties = {
        fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'block',
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', background: 'var(--bg-input)',
        border: '1px solid var(--border-color)', borderRadius: '8px',
        padding: '8px 12px', fontSize: '13px', outline: 'none',
        transition: 'var(--transition-fast)',
    };

    const isMobilePanelCheck = window.innerWidth <= 768;

    return (
        <aside
            ref={panelRef}
            className={`fade-in${isMobilePanelCheck ? ' mobile-overlay-panel' : ''}`}
            style={{
                width: isMobilePanelCheck ? '100%' : '400px',
                background: 'var(--bg-panel)',
                borderLeft: isMobilePanelCheck ? 'none' : '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                height: '100vh',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div style={{
                height: 'var(--header-height)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '14px' }}>
                    <Edit2 size={16} color="var(--accent-primary)" />
                    Task Details
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        onClick={onComplete}
                        title="Complete task"
                        style={{ padding: '6px', borderRadius: '6px', color: 'var(--accent-success)', background: 'transparent', cursor: 'pointer', border: 'none' }}
                    >
                        <Check size={16} />
                    </button>
                    <button
                        onClick={onClose}
                        style={{ padding: '6px', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Title */}
                <div>
                    <input
                        value={editTitle}
                        onChange={e => {
                            const val = e.target.value;
                            // Real-time parsing: check for keywords as user types
                            const parsed = parseNaturalInput(val);
                            if (parsed.detectedPriority || parsed.detectedDate) {
                                // Keyword detected — apply immediately and strip from title
                                const updates: Partial<TodoTask> = { title: parsed.cleanTitle || val.trim() };
                                if (parsed.detectedPriority) {
                                    updates.priority = parsed.detectedPriority;
                                    setEditPriority(parsed.detectedPriority);
                                }
                                if (parsed.detectedDate) {
                                    updates.dueDate = parsed.detectedDate;
                                    setEditDueDate(parsed.detectedDate);
                                }
                                setEditTitle(updates.title!);
                                onUpdate(updates);
                            } else {
                                setEditTitle(val);
                            }
                        }}
                        onBlur={() => {
                            if (editTitle.trim() && editTitle !== task.title) {
                                onUpdate({ title: editTitle.trim() });
                            }
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        style={{
                            ...inputStyle,
                            fontSize: '16px',
                            fontWeight: 600,
                            border: 'none',
                            background: 'transparent',
                            padding: '4px 0',
                        }}
                    />
                </div>

                {/* Description */}
                <div>
                    <label style={fieldLabelStyle}>Description</label>
                    <textarea
                        value={editDescription}
                        onChange={e => setEditDescription(e.target.value)}
                        onBlur={() => {
                            if (editDescription !== (task.description || '')) {
                                onUpdate({ description: editDescription || undefined });
                            }
                        }}
                        placeholder="Add a description..."
                        rows={3}
                        style={{
                            ...inputStyle,
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            minHeight: '60px',
                        }}
                    />
                </div>

                {/* Due Date & Scheduled Date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                        <label style={fieldLabelStyle}>Due Date</label>
                        <input
                            type="date"
                            value={editDueDate}
                            onChange={e => {
                                setEditDueDate(e.target.value);
                                onUpdate({ dueDate: e.target.value || undefined });
                            }}
                            style={inputStyle}
                        />
                    </div>
                    <div>
                        <label style={fieldLabelStyle}>Scheduled Date</label>
                        <input
                            type="date"
                            value={editScheduledDate}
                            onChange={e => {
                                setEditScheduledDate(e.target.value);
                                onUpdate({ scheduledDate: e.target.value || undefined });
                            }}
                            style={inputStyle}
                        />
                    </div>
                </div>

                {/* Priority */}
                <div>
                    <label style={fieldLabelStyle}>Priority</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        {(['p1', 'p2', 'p3', 'none'] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => {
                                    setEditPriority(p);
                                    onUpdate({ priority: p });
                                }}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    background: editPriority === p ? 'rgba(255,255,255,0.1)' : 'var(--bg-input)',
                                    border: editPriority === p ? `2px solid ${getPriorityColor(p)}` : '1px solid var(--border-color)',
                                    color: getPriorityColor(p),
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    transition: 'var(--transition-fast)',
                                }}
                            >
                                <Flag size={12} />
                                {p === 'none' ? '—' : p.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Section */}
                <div>
                    <label style={fieldLabelStyle}>Section</label>
                    <select
                        value={editSection}
                        onChange={e => {
                            setEditSection(e.target.value);
                            onUpdate({ section: e.target.value });
                        }}
                        style={inputStyle}
                    >
                        <option value="inbox">📥 Inbox</option>
                        {sections.filter(s => s !== 'inbox').map(s => (
                            <option key={s} value={s}>
                                {s === 'personal' ? '🏠 Personal' : s === 'work' ? '💼 Work' : s}
                            </option>
                        ))}
                    </select>
                </div>

                {/* PERT Info */}
                {task.pertProjectName && (
                    <div style={{
                        background: 'rgba(99, 102, 241, 0.06)',
                        border: '1px solid rgba(99, 102, 241, 0.15)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                    }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                            PERT Project
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <Tag size={12} /> {task.pertProjectName}
                        </div>
                        {(task as any).durationDays && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                Duration: {(task as any).durationDays} days
                            </div>
                        )}
                        {task.description && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                                {task.description}
                            </div>
                        )}
                    </div>
                )}

                {/* Subtasks */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>
                            Sub-tasks {subtasks.length > 0 && `(${completedSubtasks.length}/${subtasks.length})`}
                        </label>
                        <button
                            onClick={() => { setShowAddSubtask(true); setTimeout(() => subtaskInputRef.current?.focus(), 50); }}
                            style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                                color: 'var(--accent-primary)', background: 'rgba(99, 102, 241, 0.08)',
                                border: '1px solid rgba(99, 102, 241, 0.2)',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                            }}
                        >
                            <Plus size={12} /> Add
                        </button>
                    </div>

                    {/* Active subtasks */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {activeSubtasks.map(sub => (
                            <div key={sub.id} style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '8px 10px', borderRadius: '8px',
                                background: 'rgba(255,255,255,0.03)',
                                transition: 'var(--transition-fast)',
                            }}>
                                <button
                                    onClick={() => onSubtaskComplete(sub.id)}
                                    style={{
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        border: '2px solid var(--text-faint)',
                                        background: 'transparent', flexShrink: 0,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                />
                                <span style={{ fontSize: '13px', flex: 1 }}>{sub.title}</span>
                                <button
                                    onClick={() => onSubtaskDelete(sub.id)}
                                    style={{ padding: '2px', color: 'var(--text-faint)', background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.5 }}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Completed subtasks */}
                    {completedSubtasks.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                            {completedSubtasks.map(sub => (
                                <div key={sub.id} style={{
                                    display: 'flex', alignItems: 'center', gap: '10px',
                                    padding: '6px 10px', opacity: 0.4,
                                }}>
                                    <div style={{
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        background: 'var(--accent-success-soft)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        <Check size={10} color="var(--accent-success)" />
                                    </div>
                                    <span style={{ fontSize: '13px', textDecoration: 'line-through', flex: 1 }}>{sub.title}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add subtask input */}
                    {showAddSubtask && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }} className="fade-in">
                            <input
                                ref={subtaskInputRef}
                                value={newSubtaskTitle}
                                onChange={e => setNewSubtaskTitle(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && newSubtaskTitle.trim()) handleAddSubtask();
                                    if (e.key === 'Escape') { setShowAddSubtask(false); setNewSubtaskTitle(''); }
                                }}
                                placeholder="Sub-task title..."
                                style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: '12px' }}
                            />
                            <button
                                onClick={handleAddSubtask}
                                disabled={!newSubtaskTitle.trim()}
                                style={{
                                    padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
                                    background: 'var(--accent-primary)', color: 'white',
                                    opacity: newSubtaskTitle.trim() ? 1 : 0.5,
                                    border: 'none', cursor: 'pointer',
                                }}
                            >
                                Add
                            </button>
                            <button
                                onClick={() => { setShowAddSubtask(false); setNewSubtaskTitle(''); }}
                                style={{ padding: '6px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {subtasks.length === 0 && !showAddSubtask && (
                        <div style={{ fontSize: '12px', color: 'var(--text-faint)', padding: '8px 0' }}>
                            No sub-tasks yet
                        </div>
                    )}
                </div>

                {/* Metadata */}
                <div style={{
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '16px',
                    fontSize: '11px',
                    color: 'var(--text-faint)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                }}>
                    <div>Created: {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                    <div>Updated: {new Date(task.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                </div>

                {/* Delete */}
                <button
                    onClick={onDelete}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        padding: '10px', borderRadius: '8px', fontSize: '13px',
                        color: 'var(--priority-p1)', background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        cursor: 'pointer', transition: 'var(--transition-fast)',
                        marginTop: '4px',
                    }}
                >
                    <Trash2 size={14} /> Delete task
                </button>
            </div>
        </aside>
    );
}

/* ═══════════════════════════════════════════════════ */
/*              COMPLETED SECTION                      */
/* ═══════════════════════════════════════════════════ */

function CompletedSection({ tasks, onUncomplete, onDelete }: {
    tasks: TodoTask[];
    onUncomplete: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    padding: '6px 0',
                    width: '100%',
                    textAlign: 'left',
                }}
            >
                <ChevronRight size={14} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'var(--transition-fast)' }} />
                Completed ({tasks.length})
            </button>
            {expanded && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {tasks.map(task => (
                        <div
                            key={task.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                opacity: 0.5,
                            }}
                        >
                            <button
                                onClick={() => onUncomplete(task.id)}
                                title="Mark incomplete"
                                style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: 'var(--accent-success-soft)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    border: 'none',
                                }}
                            >
                                <Check size={12} color="var(--accent-success)" />
                            </button>
                            <span style={{ fontSize: '14px', textDecoration: 'line-through', flex: 1 }}>
                                {task.title}
                            </span>
                            <button
                                onClick={() => onDelete(task.id)}
                                style={{ padding: '4px', borderRadius: '4px', color: 'var(--text-muted)' }}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default App;
