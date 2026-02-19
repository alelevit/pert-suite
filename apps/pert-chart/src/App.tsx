import { useState, useMemo, useEffect, useRef } from 'react';
import type { PertTask } from './logic/pert';
import { calculateCPM, createEmptyTask, computeCalendarDates } from './logic/pert';
import type { CalendarRange } from './logic/pert';
import GraphView from './components/GraphView';
import TaskReviewPage from './components/TaskReviewPage';
import ProjectManager from './components/ProjectManager';
import { Settings, Loader2, FolderOpen, Save, ListChecks, XCircle, PanelLeftClose, PanelLeft, FilePlus2, MessageSquare, Send, CalendarDays, ClipboardList, Wrench, Sparkles } from 'lucide-react';
import { mockGenerate, generateProjectBreakdown, continueConversation, modifyChartViaChat, mockModifyChart } from './services/llm';
import { scanDirectory, type ProjectContext } from './logic/fileScanner';
import { apiUpdateProject, apiMigrateFromLocalStorage, apiExportToTodo } from './services/projectApi';

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function App() {
  const [tasks, setTasks] = useState<PertTask[]>([
    { id: '1', name: 'Define Scope', optimistic: 1, likely: 2, pessimistic: 3, dependencies: [] },
    { id: '2', name: 'Market Research', optimistic: 2, likely: 3, pessimistic: 6, dependencies: ['1'] },
    { id: '3', name: 'Technical Spec', optimistic: 1, likely: 2, pessimistic: 4, dependencies: ['1'] },
    { id: '4', name: 'Prototype', optimistic: 3, likely: 5, pessimistic: 8, dependencies: ['2', '3'] },
  ]);

  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('pert_api_key') || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('pert_model') || 'gpt-4o');
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);

  // Review Mode - tasks pending review before chart
  const [pendingTasks, setPendingTasks] = useState<PertTask[] | null>(null);

  // Project Manager
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [errorRange, setErrorRange] = useState(25);

  // Project Start Date
  const [projectStartDate, setProjectStartDate] = useState<string>('');

  // Chat Drawer
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<'generate' | 'modify'>('generate');
  const [chatFirst, setChatFirst] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'ai' | 'user', content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Export feedback
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('pert_suite_theme') || 'midnight');

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pert_suite_theme', theme);
  }, [theme]);

  // Auto-migrate from localStorage on startup
  useEffect(() => {
    apiMigrateFromLocalStorage().then(count => {
      if (count > 0) {
        console.log(`Migrated ${count} projects from localStorage to file storage`);
      }
    });
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const pertNodes = useMemo(() => calculateCPM(tasks), [tasks]);
  const projectDuration = useMemo(() => {
    return pertNodes.reduce((max, node) => Math.max(max, node.earlyFinish), 0);
  }, [pertNodes]);

  // Compute calendar dates from project start date
  const calendarDates = useMemo<Map<string, CalendarRange>>(() => {
    if (!projectStartDate) return new Map();
    return computeCalendarDates(pertNodes, projectStartDate);
  }, [pertNodes, projectStartDate]);

  const updateTask = (id: string, field: keyof PertTask, value: string | number | string[]) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const updateDependencies = (id: string, depsString: string) => {
    const deps = depsString.split(',').map(s => s.trim()).filter(Boolean);
    updateTask(id, 'dependencies', deps);
  };

  const addTask = () => {
    setTasks(prev => [...prev, createEmptyTask()]);
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const updateLikelyTime = (id: string, likely: number) => {
    const range = errorRange / 100;
    const optimistic = Math.max(1, Math.round(likely * (1 - range)));
    const pessimistic = Math.round(likely * (1 + range));
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, likely, optimistic, pessimistic } : t
    ));
  };

  const handleLinkFolder = async () => {
    try {
      const context = await scanDirectory();
      setProjectContext(context);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        alert("Error accessing folder: " + e.message);
      }
    }
  };

  // === Generate/Chat First ===
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);

    try {
      if (chatFirst && chatHistory.length === 0 && apiKey && prompt.toLowerCase() !== 'mock') {
        const aiResponse = await continueConversation(prompt, [], apiKey, selectedModel, projectContext || undefined);
        setChatHistory([{ role: 'ai', content: aiResponse }]);
        setChatOpen(true);
        setChatMode('generate');
        setIsGenerating(false);
        return;
      }

      const fullContext = chatHistory.length > 0
        ? `${prompt}\n\nConversation:\n${chatHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
        : prompt;

      let newTasks;
      if (apiKey && prompt.toLowerCase() !== 'mock') {
        newTasks = await generateProjectBreakdown(fullContext, apiKey, selectedModel, projectContext || undefined);
      } else {
        newTasks = await mockGenerate(prompt);
      }

      setPendingTasks(newTasks);
      setChatHistory([]);
      setChatOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      alert("Error: " + msg);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Chat Reply (Generate mode) ===
  const handleChatReply = async (reply: string) => {
    const newHistory = [...chatHistory, { role: 'user' as const, content: reply }];
    setChatHistory(newHistory);

    if (apiKey) {
      setIsGenerating(true);
      try {
        const aiResponse = await continueConversation(prompt, newHistory, apiKey, selectedModel, projectContext || undefined);
        setChatHistory(prev => [...prev, { role: 'ai', content: aiResponse }]);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        alert("Error: " + msg);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  // === Modify Chart via Chat ===
  const handleModifyChat = async (message: string) => {
    const newHistory = [...chatHistory, { role: 'user' as const, content: message }];
    setChatHistory(newHistory);
    setIsGenerating(true);

    try {
      let result;
      if (apiKey) {
        result = await modifyChartViaChat(tasks, message, chatHistory, apiKey, selectedModel);
      } else {
        result = await mockModifyChart(tasks, message);
      }

      setTasks(result.tasks);
      setChatHistory(prev => [...prev, { role: 'ai', content: result.summary }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setChatHistory(prev => [...prev, { role: 'ai', content: `❌ Error: ${msg}` }]);
    } finally {
      setIsGenerating(false);
    }
  };

  // === Send chat message ===
  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || isGenerating) return;
    setChatInput('');

    if (chatMode === 'modify') {
      handleModifyChat(msg);
    } else {
      handleChatReply(msg);
    }
  };

  const handleConfirmTasks = (reviewedTasks: PertTask[]) => {
    setTasks(reviewedTasks);
    setPendingTasks(null);
  };

  const handleCancelReview = () => {
    setPendingTasks(null);
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('pert_api_key', key);
  };

  const saveModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('pert_model', model);
  };

  const handleLoadProject = (loadedTasks: PertTask[], description: string, projectId: string, projectName: string) => {
    setTasks(loadedTasks);
    setPrompt(description);
    setCurrentProjectId(projectId);
    setCurrentProjectName(projectName);
  };

  const handleQuickSave = async () => {
    if (currentProjectId) {
      try {
        await apiUpdateProject(currentProjectId, { name: currentProjectName, description: prompt, tasks, startDate: projectStartDate || undefined });
        alert(`Project "${currentProjectName}" saved!`);
      } catch (e) {
        alert(`Failed to save: ${e}`);
      }
    } else {
      setShowProjectManager(true);
    }
  };

  // === Export to Todo ===
  const handleExportToTodo = async () => {
    if (!currentProjectId) {
      alert('Please save your project first before exporting to Todo.');
      return;
    }

    try {
      setExportStatus('Exporting...');
      const nodesForExport = pertNodes.map(n => ({
        id: n.id,
        name: n.name,
        optimistic: n.optimistic,
        likely: n.likely,
        pessimistic: n.pessimistic,
        dependencies: n.dependencies,
        earlyStart: n.earlyStart,
        earlyFinish: n.earlyFinish,
        duration: n.duration,
      }));

      const result = await apiExportToTodo(currentProjectId, nodesForExport, projectStartDate || undefined);
      setExportStatus(`✅ Exported ${result.exported} tasks to Todo!`);
      setTimeout(() => setExportStatus(null), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setExportStatus(`❌ Export failed: ${msg}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  };

  return (
    <div className="flex-row w-full h-full relative">

      {/* Task Review Page */}
      {pendingTasks && (
        <TaskReviewPage
          tasks={pendingTasks}
          onConfirm={handleConfirmTasks}
          onCancel={handleCancelReview}
        />
      )}

      {/* Project Manager Modal */}
      {showProjectManager && (
        <ProjectManager
          currentTasks={tasks}
          currentDescription={prompt}
          onLoadProject={handleLoadProject}
          onClose={() => setShowProjectManager(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setShowSettings(false)}>
          <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', width: '420px', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '16px' }}>Settings</h2>

            {/* Theme Picker */}
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
              Theme
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
              {[
                { id: 'midnight', label: 'Midnight', bg: '#0f172a', panel: '#1e293b' },
                { id: 'antigravity', label: 'Antigravity', bg: '#1a1b26', panel: '#24283b' },
                { id: 'soft-light', label: 'Soft Light', bg: '#faf8f5', panel: '#f0ece6' },
                { id: 'daylight', label: 'Daylight', bg: '#ffffff', panel: '#f8fafc' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', borderRadius: '10px',
                    border: theme === t.id ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)',
                    background: theme === t.id ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                    cursor: 'pointer', color: 'var(--text-main)',
                  }}
                >
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: `linear-gradient(135deg, ${t.bg} 50%, ${t.panel} 50%)`,
                    border: '1px solid rgba(128,128,128,0.2)',
                    flexShrink: 0,
                  }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500, textAlign: 'left' }}>{t.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'left' }}>{t.bg}</div>
                  </div>
                </button>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', marginBottom: '16px' }} />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              OpenAI API Key (Stored in LocalStorage)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => saveApiKey(e.target.value)}
              placeholder="sk-..."
              style={{
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '8px', borderRadius: '6px', color: 'white', marginBottom: '16px',
                width: '100%', boxSizing: 'border-box'
              }}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              LLM Model
            </label>
            <select
              value={selectedModel}
              onChange={e => saveModel(e.target.value)}
              style={{
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '8px', borderRadius: '6px', color: 'white', marginBottom: '24px',
                width: '100%', boxSizing: 'border-box', outline: 'none'
              }}
            >
              <optgroup label="GPT-4 Series">
                <option value="gpt-4o">GPT-4o (Recommended)</option>
                <option value="gpt-4o-mini">GPT-4o Mini (Faster)</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
              </optgroup>
              <optgroup label="GPT-3.5">
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              </optgroup>
            </select>
            <button onClick={() => setShowSettings(false)} style={{ background: 'var(--accent-primary)', padding: '8px 16px', borderRadius: '6px', width: '100%', textAlign: 'center' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Top Controls */}
      <div style={{ position: 'absolute', top: '16px', right: chatOpen ? '416px' : '16px', zIndex: 50, display: 'flex', gap: '8px', transition: 'right 0.3s ease' }}>
        <button
          onClick={() => {
            setTasks([]);
            setPrompt('');
            setCurrentProjectId(null);
            setCurrentProjectName('Untitled Project');
            setProjectContext(null);
            setProjectStartDate('');
          }}
          title="New Project"
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <FilePlus2 size={18} /> New
        </button>
        <button
          onClick={() => setPendingTasks([...tasks])}
          title="Edit Tasks & Dependencies"
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <ListChecks size={18} /> Edit Tasks
        </button>
        <button
          onClick={handleExportToTodo}
          title="Export tasks to Todo app"
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-primary)', fontSize: '13px', fontWeight: 500 }}
        >
          <ClipboardList size={18} /> Export to Todo
        </button>
        <button
          onClick={handleQuickSave}
          title={currentProjectId ? `Save ${currentProjectName}` : 'Save Project'}
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <Save size={18} />
          {currentProjectId ? 'Save' : 'Save As'}
        </button>
        <button
          onClick={() => setShowProjectManager(true)}
          style={{ padding: '8px 12px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}
        >
          <FolderOpen size={18} /> Projects
        </button>
        <button
          onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setChatHistory([]); }}
          title="Toggle Chat"
          style={{
            padding: '8px 12px', background: chatOpen ? 'var(--accent-primary)' : 'var(--bg-panel)',
            borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px',
            color: chatOpen ? 'white' : 'var(--text-muted)', fontSize: '13px'
          }}
        >
          <MessageSquare size={18} /> Chat
        </button>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <Settings size={20} color="var(--text-muted)" />
        </button>
      </div>

      {/* Export Status Toast */}
      {exportStatus && (
        <div style={{
          position: 'absolute', top: '64px', right: chatOpen ? '416px' : '16px', zIndex: 60,
          background: 'var(--bg-panel)', padding: '12px 20px', borderRadius: '10px',
          border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-main)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'right 0.3s ease',
          animation: 'fadeIn 0.3s ease'
        }}>
          {exportStatus}
        </div>
      )}

      {/* Sidebar Toggle Button (when collapsed) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          style={{
            position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
            zIndex: 20, background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
            borderRadius: '8px', padding: '12px 8px', cursor: 'pointer'
          }}
          title="Show sidebar"
        >
          <PanelLeft size={20} color="var(--text-muted)" />
        </button>
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{
          width: '400px',
          borderRight: '1px solid var(--border-color)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10
        }}>
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h1 style={{ fontSize: '20px', margin: 0 }}>PERT Generator</h1>
              <button
                onClick={() => setSidebarOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                title="Hide sidebar"
              >
                <PanelLeftClose size={18} color="var(--text-muted)" />
              </button>
            </div>
            <p style={{ fontSize: '12px', margin: 0 }}>Estimate: <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{projectDuration.toFixed(1)} days</span></p>

            {/* Project Start Date */}
            <div style={{ marginTop: '12px', padding: '8px', background: 'var(--bg-app)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CalendarDays size={12} /> Project Start Date
                </label>
                {projectStartDate && (
                  <span style={{ fontSize: '11px', color: 'var(--accent-success)', fontWeight: 500 }}>
                    Ends ~{formatShortDate(
                      (() => {
                        const d = new Date(projectStartDate + 'T00:00:00');
                        d.setDate(d.getDate() + Math.round(projectDuration));
                        return d.toISOString().split('T')[0];
                      })()
                    )}
                  </span>
                )}
              </div>
              <input
                type="date"
                value={projectStartDate}
                onChange={e => setProjectStartDate(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-node)', border: 'none',
                  color: 'var(--text-main)', padding: '6px', borderRadius: '4px', fontSize: '13px',
                  colorScheme: 'dark'
                }}
              />
            </div>

            {/* Error Range Control */}
            <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-app)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Uncertainty Range</label>
                <span style={{ fontSize: '12px', color: 'var(--accent-primary)', fontWeight: 'bold' }}>±{errorRange}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                step="5"
                value={errorRange}
                onChange={e => setErrorRange(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
              />
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                O = M−{errorRange}%, P = M+{errorRange}%
              </div>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {tasks.map((task) => {
              const dateRange = calendarDates.get(task.id);
              return (
                <div key={task.id} style={{
                  background: 'var(--bg-app)',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <input
                      value={task.name}
                      onChange={(e) => updateTask(task.id, 'name', e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontWeight: 'bold', width: '100%' }}
                    />
                    <button onClick={() => removeTask(task.id)} style={{ color: 'var(--accent-critical)', fontSize: '16px', padding: '0 8px' }}>×</button>
                  </div>

                  {/* Date Range Badge (when start date is set) */}
                  {dateRange && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px',
                      padding: '4px 8px', background: 'rgba(99, 102, 241, 0.1)',
                      borderRadius: '4px', fontSize: '11px', color: 'var(--accent-primary)'
                    }}>
                      <CalendarDays size={12} />
                      <span>{formatShortDate(dateRange.startDate)} → {formatShortDate(dateRange.endDate)}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>Duration (days)</label>
                      <input
                        type="number"
                        value={task.likely}
                        onChange={(e) => updateLikelyTime(task.id, Number(e.target.value))}
                        min="1"
                        style={{ background: 'var(--bg-node)', border: 'none', color: 'var(--text-main)', padding: '6px', borderRadius: '4px', width: '100%', fontSize: '14px' }}
                      />
                    </div>
                    <div style={{ flex: 3, display: 'flex', gap: '4px' }}>
                      <div style={{
                        flex: 1, padding: '6px', background: 'var(--bg-node)', borderRadius: '4px',
                        fontSize: '11px', textAlign: 'center', color: 'var(--text-muted)'
                      }}>
                        <div style={{ fontSize: '9px', marginBottom: '2px' }}>Opt</div>
                        <span style={{ color: 'var(--accent-success)' }}>{task.optimistic}d</span>
                      </div>
                      <div style={{
                        flex: 1, padding: '6px', background: 'var(--bg-node)', borderRadius: '4px',
                        fontSize: '11px', textAlign: 'center', color: 'var(--text-muted)'
                      }}>
                        <div style={{ fontSize: '9px', marginBottom: '2px' }}>Likely</div>
                        <span style={{ color: 'var(--accent-primary)' }}>{task.likely}d</span>
                      </div>
                      <div style={{
                        flex: 1, padding: '6px', background: 'var(--bg-node)', borderRadius: '4px',
                        fontSize: '11px', textAlign: 'center', color: 'var(--text-muted)'
                      }}>
                        <div style={{ fontSize: '9px', marginBottom: '2px' }}>Pess</div>
                        <span style={{ color: 'var(--accent-critical)' }}>{task.pessimistic}d</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>Depends On (IDs)</label>
                    <input value={task.dependencies.join(', ')} onChange={(e) => updateDependencies(task.id, e.target.value)} style={{ background: 'var(--bg-node)', border: 'none', color: 'var(--text-main)', padding: '4px', borderRadius: '4px', fontSize: '12px', width: '100%' }} />
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>ID: {task.id}</div>
                  </div>
                </div>
              );
            })}
            <button onClick={addTask} style={{ background: 'var(--bg-node)', padding: '12px', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)' }}>+ Add Manual Task</button>
          </div>
        </div>
      )}


      {/* Graph Area */}
      <div style={{ flex: 1, background: 'var(--bg-app)', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <GraphView pertNodes={pertNodes} calendarDates={calendarDates} />

        {/* Generation Input */}
        <div style={{
          position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30, 41, 59, 0.9)', backdropFilter: 'blur(8px)', padding: '16px',
          borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '8px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)', width: '600px', maxWidth: '90%'
        }}>
          {/* Chat First Toggle */}
          <button
            onClick={() => setChatFirst(!chatFirst)}
            title={chatFirst ? "Chat First (ON) - AI will ask clarifying questions before generating" : "Chat First (OFF) - Generate tasks directly"}
            style={{
              background: chatFirst ? 'var(--accent-primary)' : 'var(--bg-node)',
              padding: '8px', borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            <MessageSquare size={18} color={chatFirst ? 'white' : 'var(--text-muted)'} />
          </button>

          <button
            onClick={handleLinkFolder}
            title="Link local project folder for context"
            style={{
              background: projectContext ? 'var(--accent-success)' : 'var(--bg-node)',
              padding: '8px', borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            <FolderOpen size={18} color={projectContext ? 'white' : 'var(--text-muted)'} />
            {projectContext && <span style={{ fontSize: '10px', color: 'white' }}>Linked</span>}
          </button>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder={chatFirst ? "Describe project (AI will ask questions first)..." : "Describe your project to generate tasks..."}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '14px', outline: 'none' }}
            />
            {projectContext && (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{projectContext.structure.length} files scanned</span>
                <button onClick={() => setProjectContext(null)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}>
                  <XCircle size={12} color="var(--accent-critical)" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              background: 'var(--accent-primary)', color: 'white', padding: '8px 16px',
              borderRadius: '8px', fontWeight: 600, fontSize: '14px', opacity: isGenerating ? 0.7 : 1,
              minWidth: '100px', display: 'flex', justifyContent: 'center', alignItems: 'center'
            }}
          >
            {isGenerating ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : (chatFirst && chatHistory.length === 0 ? 'Chat First' : 'Generate')}
          </button>
        </div>
      </div>

      {/* Chat Drawer (Right Side) */}
      {chatOpen && (
        <div style={{
          width: '400px',
          borderLeft: '1px solid var(--border-color)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          animation: 'slideInRight 0.3s ease'
        }}>
          {/* Drawer Header */}
          <div style={{
            padding: '16px', borderBottom: '1px solid var(--border-color)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '16px', margin: 0 }}>AI Assistant</h2>
            </div>
            <button
              onClick={() => { setChatOpen(false); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
            >
              <XCircle size={18} color="var(--text-muted)" />
            </button>
          </div>

          {/* Mode Toggle */}
          <div style={{
            padding: '8px 16px', borderBottom: '1px solid var(--border-color)',
            display: 'flex', gap: '4px'
          }}>
            <button
              onClick={() => { setChatMode('generate'); setChatHistory([]); }}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: chatMode === 'generate' ? 'var(--accent-primary)' : 'var(--bg-node)',
                color: chatMode === 'generate' ? 'white' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              <Sparkles size={14} /> New Project
            </button>
            <button
              onClick={() => { setChatMode('modify'); setChatHistory([]); }}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: chatMode === 'modify' ? 'var(--accent-primary)' : 'var(--bg-node)',
                color: chatMode === 'modify' ? 'white' : 'var(--text-muted)',
                transition: 'all 0.2s ease'
              }}
            >
              <Wrench size={14} /> Modify Chart
            </button>
          </div>

          {/* Chat Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {chatHistory.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.3 }}>
                  {chatMode === 'modify' ? '🛠️' : '✨'}
                </div>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  {chatMode === 'modify'
                    ? 'Ask me to modify your chart'
                    : 'Ask me to help plan your project'}
                </p>
                <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', maxWidth: '280px', margin: '0 auto' }}>
                  {chatMode === 'modify' ? (
                    <>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Add a task called "Code Review" that takes 2 days')}>
                        💡 "Add a task called 'Code Review' that takes 2 days"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Remove the "Market Research" task')}>
                        💡 "Remove the 'Market Research' task"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('Make the Prototype task take 10 days instead of 5')}>
                        💡 "Make the Prototype task take 10 days"
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('What are the key milestones?')}>
                        💡 "What are the key milestones?"
                      </div>
                      <div style={{ padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', cursor: 'pointer' }}
                        onClick={() => setChatInput('How should we handle testing?')}>
                        💡 "How should we handle testing?"
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div key={i} style={{
                padding: '10px 14px',
                borderRadius: '12px',
                maxWidth: '90%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-app)',
                color: 'var(--text-main)',
                fontSize: '13px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                border: msg.role === 'ai' ? '1px solid var(--border-color)' : 'none'
              }}>
                {msg.content}
              </div>
            ))}

            {isGenerating && (
              <div style={{
                padding: '10px 14px', borderRadius: '12px', alignSelf: 'flex-start',
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Thinking...
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--border-color)',
            display: 'flex', gap: '8px'
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
              placeholder={chatMode === 'modify' ? 'Ask to modify the chart...' : 'Continue the conversation...'}
              disabled={isGenerating}
              style={{
                flex: 1,
                background: 'var(--bg-app)', border: '1px solid var(--border-color)',
                padding: '10px 14px', borderRadius: '8px', color: 'white', outline: 'none',
                fontSize: '13px'
              }}
            />
            <button
              onClick={handleSendChat}
              disabled={isGenerating || !chatInput.trim()}
              style={{
                background: 'var(--accent-primary)', color: 'white', padding: '10px 14px',
                borderRadius: '8px', border: 'none', cursor: 'pointer',
                opacity: isGenerating || !chatInput.trim() ? 0.5 : 1,
                display: 'flex', alignItems: 'center'
              }}
              title="Send message"
            >
              <Send size={16} />
            </button>
          </div>

          {/* Generate button (only in generate mode with history) */}
          {chatMode === 'generate' && chatHistory.length > 0 && (
            <div style={{ padding: '0 16px 12px' }}>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  width: '100%',
                  background: 'var(--accent-success)', color: 'white', padding: '10px 16px',
                  borderRadius: '8px', fontWeight: 600, fontSize: '13px', border: 'none', cursor: 'pointer',
                  opacity: isGenerating ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
              >
                ✓ Done — Generate Tasks
              </button>
            </div>
          )}
        </div>
      )}


      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default App;
