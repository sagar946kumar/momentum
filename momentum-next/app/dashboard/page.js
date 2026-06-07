'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import {
    loadData, saveData, seedIfEmpty, generateId,
    daysInMonth, monthKey, getHabitGoal,
    calcDreamProgress, calcDailyProgress, calcStreaks,
    calcHabitProgress, getWeeklyPcts, getOverallMonthlyPct,
    calcMomentumScore, escapeHtml,
} from '@/lib/appLogic';

// ─── Sub-components ─────────────────────────────────────

function Navbar({ user, onLogout, currentPage, onNavigate }) {
    return (
        <nav className="navbar">
            <a href="#" className="nav-logo" onClick={e => { e.preventDefault(); onNavigate('landing'); }}>
                <span className="logo-icon">◆</span> Momentum
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <div className="nav-links">
                    <span className={`nav-link${currentPage === 'landing' || currentPage === 'dream' ? ' active' : ''}`} onClick={() => onNavigate('landing')}>Dreams</span>
                    <span className={`nav-link${currentPage === 'map' ? ' active' : ''}`} onClick={() => onNavigate('map')}>Map Your Day</span>
                    <span className={`nav-link${currentPage === 'dashboard' ? ' active' : ''}`} onClick={() => onNavigate('dashboard')}>Dashboard</span>
                </div>
                {user && (
                    <div className="user-profile">
                        <img src={user.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}`} alt="User" className="nav-avatar" />
                        <div className="user-info">
                            <span className="nav-user-name">{user.name}</span>
                            <button className="logout-link" onClick={onLogout}>Sign out</button>
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}

function Modal({ id, open, onClose, title, children, footer }) {
    return (
        <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal">
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}

// ─── Map Your Day: Full System ───────────────────────────

// Utility: format milliseconds to "Xm Ys"
function fmtMs(ms) {
    if (!ms || ms <= 0) return '0m 0s';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s}s`;
}

// Utility: format timestamp to HH:MM
function fmtTime(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Arrow SVG connector between nodes
function ArrowConnector({ label }) {
    return (
        <div className="myd-arrow-connector">
            <div className="myd-arrow-line" />
            <svg className="myd-arrow-head" width="12" height="8" viewBox="0 0 12 8">
                <path d="M6 8L0 0h12z" fill="var(--blue)" />
            </svg>
            {label && <div className="myd-arrow-label">{label}</div>}
        </div>
    );
}

// Task card with session engine
function TaskFlowCard({ task, onSessionAction, onPlusClick, isLast }) {
    const totalMs = (task.sessions || []).reduce((sum, s) => {
        if (s.endTime) return sum + (new Date(s.endTime) - new Date(s.startTime));
        if (s.startTime && task.status === 'running') {
            return sum + (Date.now() - new Date(s.startTime));
        }
        return sum;
    }, 0);

    const isRunning = task.status === 'running';
    const isPaused = task.status === 'paused';
    const isCompleted = task.status === 'completed';
    const isActive = task.status === 'active' || isRunning || isPaused;

    const currentSession = task.sessions && task.sessions[task.sessions.length - 1];

    return (
        <div className="myd-task-branch">
            {/* Task Node */}
            <div className={`myd-task-card ${isCompleted ? 'myd-task-completed' : isRunning ? 'myd-task-running' : isPaused ? 'myd-task-paused' : ''}`}>
                <div className="myd-task-card-header">
                    <div className="myd-task-status-dot" />
                    <span className="myd-task-name">{task.name}</span>
                    {task.dreamTitle && (
                        <span className="myd-task-dream-badge">{task.dreamTitle}</span>
                    )}
                </div>

                {/* Sessions List */}
                {task.sessions && task.sessions.length > 0 && (
                    <div className="myd-sessions-list">
                        {task.sessions.map((s, i) => (
                            <div key={i} className="myd-session-row">
                                <span className="myd-session-num">Session {i + 1}</span>
                                <span className="myd-session-time">
                                    {fmtTime(s.startTime)} → {s.endTime ? fmtTime(s.endTime) : <span className="myd-session-live">● live</span>}
                                </span>
                                {s.endTime && (
                                    <span className="myd-session-dur">{fmtMs(new Date(s.endTime) - new Date(s.startTime))}</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Controls */}
                {!isCompleted && (
                    <div className="myd-task-controls">
                        {!isRunning && !isPaused && task.status === 'active' && (
                            <button className="myd-btn myd-btn-start" onClick={() => onSessionAction(task.id, 'start')}>
                                ▶ Start
                            </button>
                        )}
                        {isRunning && (
                            <>
                                <button className="myd-btn myd-btn-pause" onClick={() => onSessionAction(task.id, 'pause')}>
                                    ⏸ Pause
                                </button>
                                <button className="myd-btn myd-btn-complete" onClick={() => onSessionAction(task.id, 'complete')}>
                                    ✓ Complete
                                </button>
                            </>
                        )}
                        {isPaused && (
                            <>
                                <button className="myd-btn myd-btn-start" onClick={() => onSessionAction(task.id, 'resume')}>
                                    ▶ Resume
                                </button>
                                <button className="myd-btn myd-btn-complete" onClick={() => onSessionAction(task.id, 'complete')}>
                                    ✓ Complete
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Total Time */}
                {isCompleted && (
                    <div className="myd-task-total">
                        <span>✓ Completed</span>
                        <span className="myd-task-total-time">
                            {(task.sessions || []).length} session{(task.sessions || []).length !== 1 ? 's' : ''} · Total: {fmtMs(totalMs)}
                        </span>
                    </div>
                )}
                {isRunning && (
                    <div className="myd-task-running-indicator">
                        <span className="myd-pulse" /> Running…
                    </div>
                )}
                {isPaused && (
                    <div className="myd-task-paused-indicator">
                        ⏸ Paused · {fmtMs(totalMs)} so far
                    </div>
                )}
            </div>

            {/* Plus button below task */}
            {!isCompleted && isActive && (
                <>
                    <ArrowConnector />
                    <button className="myd-plus-btn" onClick={() => onPlusClick(task.id)}>
                        +
                    </button>
                </>
            )}
            {isCompleted && (
                <>
                    <ArrowConnector label={`Total: ${fmtMs(totalMs)}`} />
                    <button className="myd-plus-btn myd-plus-btn-completed" onClick={() => onPlusClick(task.id)}>
                        +
                    </button>
                </>
            )}
        </div>
    );
}

function MapYourDay({ appData, persist, onNavigate }) {
    // ── State ────────────────────────────────────────────────
    const [flowState, setFlowState] = useState(() => {
        const key = `myd_flow_${new Date().toDateString()}`;
        try {
            const saved = localStorage.getItem(key);
            if (saved) return JSON.parse(saved);
        } catch {}
        return {
            date: new Date().toDateString(),
            rootTaskIds: [],      // task IDs directly spawned from To-Do List
            tasks: {},            // { [taskId]: TaskObject }
            children: {},         // { [parentTaskId]: [childTaskId, ...] }
        };
    });

    const [todoOpen, setTodoOpen] = useState(false);
    const [todoContext, setTodoContext] = useState(null); // null = from root, string = parent taskId
    const [selectedTasks, setSelectedTasks] = useState([]);
    const [ticker, setTicker] = useState(0);
    const [summaryOpen, setSummaryOpen] = useState(false);

    // Tick every second for live timers
    useEffect(() => {
        const iv = setInterval(() => setTicker(t => t + 1), 1000);
        return () => clearInterval(iv);
    }, []);

    // Persist flow state to localStorage
    useEffect(() => {
        const key = `myd_flow_${new Date().toDateString()}`;
        try { localStorage.setItem(key, JSON.stringify(flowState)); } catch {}
    }, [flowState]);

    // ── All tasks from appData (habits + system tasks) ───────
    const allHabits = [];
    (appData.dreams || []).forEach(d => {
        (d.habits || []).forEach(h => {
            allHabits.push({ id: `dream_${d.id}_${h.id}`, name: h.name, dreamTitle: d.title, sourceId: h.id, dreamId: d.id });
        });
    });

    // Tasks not yet in the flow
    const usedNames = new Set(Object.values(flowState.tasks).map(t => t.name));
    const availableTasks = allHabits.filter(h => !usedNames.has(h.name));
    const completedCount = Object.values(flowState.tasks).filter(t => t.status === 'completed').length;
    const totalInFlow = Object.keys(flowState.tasks).length;

    // ── Open To-Do selector ──────────────────────────────────
    function openTodoList(parentId = null) {
        setTodoContext(parentId);
        setSelectedTasks([]);
        setTodoOpen(true);
    }

    function toggleTaskSelect(habitId) {
        setSelectedTasks(prev =>
            prev.includes(habitId) ? prev.filter(x => x !== habitId) : [...prev, habitId]
        );
    }

    function confirmTaskSelection() {
        if (selectedTasks.length === 0) { setTodoOpen(false); return; }

        setFlowState(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            const newIds = [];

            selectedTasks.forEach(habitId => {
                const habit = availableTasks.find(h => h.id === habitId);
                if (!habit) return;
                const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                next.tasks[taskId] = {
                    id: taskId,
                    name: habit.name,
                    dreamTitle: habit.dreamTitle,
                    status: 'active',
                    sessions: [],
                    addedAt: new Date().toISOString(),
                };
                if (!next.children) next.children = {};

                if (todoContext) {
                    // Child of a task
                    if (!next.children[todoContext]) next.children[todoContext] = [];
                    next.children[todoContext].push(taskId);
                } else {
                    // Root tasks
                    newIds.push(taskId);
                }
            });

            if (!todoContext) {
                next.rootTaskIds = [...(next.rootTaskIds || []), ...newIds];
            }

            return next;
        });

        setTodoOpen(false);
        setSelectedTasks([]);
    }

    // ── Session Engine ────────────────────────────────────────
    function sessionAction(taskId, action) {
        setFlowState(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            const task = next.tasks[taskId];
            if (!task) return prev;

            const now = new Date().toISOString();

            if (action === 'start') {
                task.status = 'running';
                task.sessions = [...(task.sessions || []), { startTime: now, endTime: null }];
            } else if (action === 'pause') {
                task.status = 'paused';
                const last = task.sessions[task.sessions.length - 1];
                if (last && !last.endTime) last.endTime = now;
            } else if (action === 'resume') {
                task.status = 'running';
                task.sessions = [...(task.sessions || []), { startTime: now, endTime: null }];
            } else if (action === 'complete') {
                task.status = 'completed';
                const last = task.sessions[task.sessions.length - 1];
                if (last && !last.endTime) last.endTime = now;
            }
            return next;
        });
    }

    // ── Render a task and its children recursively ───────────
    function renderTaskBranch(taskId, depth = 0) {
        const task = flowState.tasks[taskId];
        if (!task) return null;
        const children = (flowState.children || {})[taskId] || [];

        return (
            <div key={taskId} className="myd-branch-wrapper" style={{ '--depth': depth }}>
                <TaskFlowCard
                    task={task}
                    onSessionAction={sessionAction}
                    onPlusClick={(id) => openTodoList(id)}
                />
                {children.length > 0 && (
                    <div className="myd-children-row">
                        {children.map(childId => renderTaskBranch(childId, depth + 1))}
                    </div>
                )}
            </div>
        );
    }

    // ── Summary ────────────────────────────────────────────────
    const allTasks = Object.values(flowState.tasks);
    const totalMs = allTasks.reduce((sum, t) => {
        return sum + (t.sessions || []).reduce((s2, sess) => {
            if (sess.endTime) return s2 + (new Date(sess.endTime) - new Date(sess.startTime));
            if (!sess.endTime && t.status === 'running') return s2 + (Date.now() - new Date(sess.startTime));
            return s2;
        }, 0);
    }, 0);

    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <>
            {/* ── To-Do List Modal ──────────────────────────── */}
            {todoOpen && (
                <div className="myd-modal-overlay" onClick={() => setTodoOpen(false)}>
                    <div className="myd-modal" onClick={e => e.stopPropagation()}>
                        <div className="myd-modal-header">
                            <div>
                                <h3 className="myd-modal-title">📋 To-Do List</h3>
                                <p className="myd-modal-sub">
                                    {availableTasks.length} tasks available · {selectedTasks.length} selected
                                </p>
                            </div>
                            <button className="myd-modal-close" onClick={() => setTodoOpen(false)}>×</button>
                        </div>
                        <div className="myd-modal-body">
                            {availableTasks.length === 0 ? (
                                <div className="myd-empty-state">🎉 All tasks are in the flow!</div>
                            ) : (
                                <div className="myd-todo-list">
                                    {availableTasks.map(h => (
                                        <label key={h.id} className={`myd-todo-item ${selectedTasks.includes(h.id) ? 'myd-todo-selected' : ''}`}>
                                            <input
                                                type="checkbox"
                                                className="myd-todo-checkbox"
                                                checked={selectedTasks.includes(h.id)}
                                                onChange={() => toggleTaskSelect(h.id)}
                                            />
                                            <div className="myd-todo-info">
                                                <span className="myd-todo-name">{h.name}</span>
                                                <span className="myd-todo-dream">{h.dreamTitle}</span>
                                            </div>
                                            {selectedTasks.includes(h.id) && <span className="myd-todo-check">✓</span>}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="myd-modal-footer">
                            <button className="myd-btn myd-btn-secondary" onClick={() => setTodoOpen(false)}>Cancel</button>
                            <button className="myd-btn myd-btn-primary" onClick={confirmTaskSelection} disabled={selectedTasks.length === 0}>
                                Done ({selectedTasks.length} selected)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Summary Modal ─────────────────────────────── */}
            {summaryOpen && (
                <div className="myd-modal-overlay" onClick={() => setSummaryOpen(false)}>
                    <div className="myd-modal myd-modal-wide" onClick={e => e.stopPropagation()}>
                        <div className="myd-modal-header">
                            <div>
                                <h3 className="myd-modal-title">📊 Day Summary</h3>
                                <p className="myd-modal-sub">{dateStr}</p>
                            </div>
                            <button className="myd-modal-close" onClick={() => setSummaryOpen(false)}>×</button>
                        </div>
                        <div className="myd-modal-body">
                            <div className="myd-summary-stats">
                                <div className="myd-summary-stat">
                                    <span className="myd-summary-val">{totalInFlow}</span>
                                    <span className="myd-summary-label">Tasks in Flow</span>
                                </div>
                                <div className="myd-summary-stat">
                                    <span className="myd-summary-val" style={{ color: 'var(--green)' }}>{completedCount}</span>
                                    <span className="myd-summary-label">Completed</span>
                                </div>
                                <div className="myd-summary-stat">
                                    <span className="myd-summary-val" style={{ color: 'var(--blue)' }}>{fmtMs(totalMs)}</span>
                                    <span className="myd-summary-label">Total Work Time</span>
                                </div>
                                <div className="myd-summary-stat">
                                    <span className="myd-summary-val">{allHabits.length}</span>
                                    <span className="myd-summary-label">Total Tasks</span>
                                </div>
                            </div>
                            <div className="myd-summary-task-list">
                                {allTasks.map(t => {
                                    const tMs = (t.sessions || []).reduce((s, sess) => {
                                        if (sess.endTime) return s + (new Date(sess.endTime) - new Date(sess.startTime));
                                        return s;
                                    }, 0);
                                    return (
                                        <div key={t.id} className="myd-summary-task-row">
                                            <span className={`myd-summary-task-status ${t.status === 'completed' ? 'done' : t.status === 'running' ? 'running' : 'active'}`}>
                                                {t.status === 'completed' ? '✓' : t.status === 'running' ? '●' : '○'}
                                            </span>
                                            <span className="myd-summary-task-name">{t.name}</span>
                                            <span className="myd-summary-task-sessions">{(t.sessions || []).length} session{(t.sessions || []).length !== 1 ? 's' : ''}</span>
                                            <span className="myd-summary-task-time">{tMs > 0 ? fmtMs(tMs) : '—'}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="myd-modal-footer">
                            <button className="myd-btn myd-btn-secondary" onClick={() => {
                                if (confirm('Reset the entire day map? This cannot be undone.')) {
                                    setFlowState({ date: new Date().toDateString(), rootTaskIds: [], tasks: {}, children: {} });
                                    setSummaryOpen(false);
                                }
                            }}>
                                🔄 Reset Day
                            </button>
                            <button className="myd-btn myd-btn-primary" onClick={() => setSummaryOpen(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Main Page ─────────────────────────────────── */}
            <div className="myd-page">

                {/* Header */}
                <div className="myd-page-header">
                    <div className="myd-header-left">
                        <h1 className="myd-page-title">Map Your Day</h1>
                        <p className="myd-page-sub">Visual productivity engine · {dateStr}</p>
                    </div>
                    <div className="myd-header-right">
                        <div className="myd-header-stats">
                            <div className="myd-header-stat">
                                <span className="myd-hs-val">{allHabits.length}</span>
                                <span className="myd-hs-label">Total Tasks</span>
                            </div>
                            <div className="myd-header-stat">
                                <span className="myd-hs-val" style={{ color: 'var(--blue)' }}>{totalInFlow}</span>
                                <span className="myd-hs-label">In Flow</span>
                            </div>
                            <div className="myd-header-stat">
                                <span className="myd-hs-val" style={{ color: 'var(--green)' }}>{completedCount}</span>
                                <span className="myd-hs-label">Done</span>
                            </div>
                            <div className="myd-header-stat">
                                <span className="myd-hs-val" style={{ color: 'var(--blue)' }}>{fmtMs(totalMs)}</span>
                                <span className="myd-hs-label">Work Time</span>
                            </div>
                        </div>
                        <button className="myd-btn myd-btn-outline" onClick={() => setSummaryOpen(true)}>
                            📊 Day Summary
                        </button>
                    </div>
                </div>

                {/* Flow Canvas */}
                <div className="myd-flow-canvas">

                    {/* Root Date Node */}
                    <div className="myd-root-node">
                        <div className="myd-date-chip">
                            {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                    </div>

                    <ArrowConnector />

                    {/* To-Do List Node */}
                    <div className="myd-todo-node" onClick={() => openTodoList(null)}>
                        <div className="myd-todo-node-icon">📋</div>
                        <div className="myd-todo-node-content">
                            <span className="myd-todo-node-title">To-Do List</span>
                            <span className="myd-todo-node-count">
                                {allHabits.length} tasks · {allHabits.length - totalInFlow} remaining
                            </span>
                        </div>
                        <div className="myd-todo-node-cta">Select →</div>
                    </div>

                    {/* Tasks Flow */}
                    {flowState.rootTaskIds && flowState.rootTaskIds.length > 0 && (
                        <>
                            <ArrowConnector label="Select" />
                            <div className="myd-flow-branches">
                                {flowState.rootTaskIds.map(taskId => renderTaskBranch(taskId))}
                            </div>
                        </>
                    )}

                    {/* Empty state prompt */}
                    {(!flowState.rootTaskIds || flowState.rootTaskIds.length === 0) && (
                        <div className="myd-empty-flow">
                            <div className="myd-empty-flow-icon">↓</div>
                            <p>Click <strong>"To-Do List"</strong> above to select your first tasks for today</p>
                        </div>
                    )}

                    {/* End of day footer */}
                    {totalInFlow > 0 && completedCount === totalInFlow && totalInFlow > 0 && (
                        <div className="myd-flow-complete-banner">
                            🎉 All tasks in your flow are complete! Total time: {fmtMs(totalMs)}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Main App Component ──────────────────────────────────
export default function DashboardPage() {
    const router = useRouter();
    const supabase = getSupabase();

    const [appData, setAppData] = useState({ dreams: [] });
    const [user, setUser] = useState(null);
    const [page, setPage] = useState('landing'); // 'landing' | 'dream' | 'dashboard'
    const [currentDreamId, setCurrentDreamId] = useState(null);
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
    const [editingDreamId, setEditingDreamId] = useState(null);
    const [dreamModalOpen, setDreamModalOpen] = useState(false);
    const [dreamModalTitle, setDreamModalTitle] = useState('');
    const [habitModalOpen, setHabitModalOpen] = useState(false);
    const [habitModalValue, setHabitModalValue] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmMsg, setConfirmMsg] = useState('');
    const [deletingType, setDeletingType] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    // Chart refs
    const dailyChartRef = useRef(null);
    const dailyChartInst = useRef(null);
    const perfChartRef = useRef(null);
    const perfChartInst = useRef(null);
    const pieChartRef = useRef(null);
    const pieChartInst = useRef(null);
    const weeklyChartRef = useRef(null);
    const weeklyChartInst = useRef(null);

    // ─── Auth Check ────────────────────────────────────────
    useEffect(() => {
        const isAuthCallback = typeof window !== 'undefined' && (
            window.location.hash.includes('access_token') ||
            window.location.hash.includes('error_description') ||
            window.location.search.includes('code')
        );

        const storedUser = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
        if (!isAuthCallback) {
            if (!storedUser || !storedUser.isLoggedIn || !storedUser.isPremium) {
                router.replace('/');
                return;
            }
            setUser(storedUser);
        }

        // Sync Supabase session
        if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    const existing = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return {}; } })() || {};
                    const u = {
                        name: session.user.user_metadata.full_name,
                        email: session.user.email,
                        picture: session.user.user_metadata.avatar_url,
                        isLoggedIn: true,
                        isPremium: existing.isPremium || false,
                    };
                    localStorage.setItem('user', JSON.stringify(u));
                    setUser(u);
                    if (!u.isPremium) router.replace('/');
                }
            }).catch(() => { });
        }

        // Load app data
        const fetchData = () => {
            loadData(supabase).then(data => {
                const seeded = seedIfEmpty(data);
                setAppData(seeded);
                if (seeded !== data) saveData(seeded, supabase);
            });
        };

        fetchData();

        // Handle visibility changes (Mobile tab refocus)
        const handleVisibility = () => { if (document.visibilityState === 'visible') fetchData(); };
        window.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('focus', fetchData);

        // Real-time listener
        let channel = null;
        if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    channel = supabase
                        .channel('user_data_sync')
                        .on('postgres_changes', {
                            event: '*',
                            schema: 'public',
                            table: 'user_data',
                            filter: `id=eq.${session.user.id}`
                        }, (payload) => {
                            if (payload.new && payload.new.dreams) {
                                console.log('Realtime update received from another device');
                                setAppData({ dreams: payload.new.dreams });
                            }
                        })
                        .subscribe();
                }
            });
        }

        return () => {
            window.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('focus', fetchData);
            if (channel) supabase.removeChannel(channel);
        };
    }, [supabase]);

    // ─── Save helper ────────────────────────────────────────
    const persist = useCallback((data) => {
        setAppData(data);
        saveData(data, supabase);
    }, [supabase]);

    // ─── Dream CRUD ─────────────────────────────────────────
    function addDream(title) {
        const dream = { id: generateId(), title: title.trim(), createdAt: new Date().toISOString(), habits: [] };
        const newData = { ...appData, dreams: [...appData.dreams, dream] };
        persist(newData);
        return dream;
    }
    function updateDream(id, title) {
        const newData = { ...appData, dreams: appData.dreams.map(d => d.id === id ? { ...d, title: title.trim() } : d) };
        persist(newData);
    }
    function deleteDream(id) {
        persist({ ...appData, dreams: appData.dreams.filter(d => d.id !== id) });
    }
    function getDream(id) { return appData.dreams.find(d => d.id === id); }

    // ─── Habit CRUD ─────────────────────────────────────────
    function addHabit(dreamId, name) {
        const today = new Date().getDate();
        const mk = monthKey(new Date().getFullYear(), new Date().getMonth());
        const tracking = {};
        tracking[mk] = {};

        // Auto-fill NA for all prior days of THIS month only
        for (let d = 1; d < today; d++) {
            tracking[mk][d] = 'na';
        }

        const habit = { id: generateId(), name: name.trim(), createdAt: new Date().toISOString(), tracking, goals: {} };
        const newData = { ...appData, dreams: appData.dreams.map(d => d.id === dreamId ? { ...d, habits: [...d.habits, habit] } : d) };
        persist(newData);
    }
    function deleteHabit(dreamId, habitId) {
        const newData = { ...appData, dreams: appData.dreams.map(d => d.id === dreamId ? { ...d, habits: d.habits.filter(h => h.id !== habitId) } : d) };
        persist(newData);
    }
    function cycleHabitDay(dreamId, habitId, mk, day) {
        const newData = JSON.parse(JSON.stringify(appData));
        const dream = newData.dreams.find(d => d.id === dreamId);
        if (!dream) return;
        const habit = dream.habits.find(h => h.id === habitId);
        if (!habit) return;
        if (!habit.tracking[mk]) habit.tracking[mk] = {};
        const current = habit.tracking[mk][day];
        if (!current) habit.tracking[mk][day] = true;
        else if (current === true) habit.tracking[mk][day] = 'na';
        else delete habit.tracking[mk][day];
        persist(newData);
    }
    function toggleHabitDay(dreamId, habitId, mk, day) {
        const newData = JSON.parse(JSON.stringify(appData));
        const dream = newData.dreams.find(d => d.id === dreamId);
        if (!dream) return;
        const habit = dream.habits.find(h => h.id === habitId);
        if (!habit) return;
        if (!habit.tracking[mk]) habit.tracking[mk] = {};
        habit.tracking[mk][day] = !habit.tracking[mk][day];
        if (!habit.tracking[mk][day]) delete habit.tracking[mk][day];
        persist(newData);
    }
    function setHabitGoal(dreamId, habitId, mk, goalValue) {
        const newData = JSON.parse(JSON.stringify(appData));
        const dream = newData.dreams.find(d => d.id === dreamId);
        if (!dream) return;
        const habit = dream.habits.find(h => h.id === habitId);
        if (!habit) return;
        if (!habit.goals) habit.goals = {};
        habit.goals[mk] = goalValue;
        persist(newData);
    }

    // ─── Logout ──────────────────────────────────────────────
    async function handleLogout() {
        if (supabase) { try { await supabase.auth.signOut(); } catch { /* ignore */ } }
        localStorage.removeItem('user');
        router.replace('/');
    }

    // ─── Modal helpers ───────────────────────────────────────
    function openDreamModal(title = '') {
        setDreamModalTitle(title);
        setDreamModalOpen(true);
    }
    function saveDream() {
        if (!dreamModalTitle.trim()) return;
        if (editingDreamId) { updateDream(editingDreamId, dreamModalTitle); setEditingDreamId(null); }
        else addDream(dreamModalTitle);
        setDreamModalOpen(false);
        setDreamModalTitle('');
    }
    function saveHabit() {
        if (!habitModalValue.trim() || !currentDreamId) return;
        addHabit(currentDreamId, habitModalValue);
        setHabitModalOpen(false);
        setHabitModalValue('');
    }
    function confirmDelete() {
        if (deletingType === 'dream') { deleteDream(deletingId); if (page === 'dream') setPage('landing'); }
        else if (deletingType === 'habit') { deleteHabit(currentDreamId, deletingId); }
        setConfirmOpen(false);
        setDeletingType(null); setDeletingId(null);
    }

    // ─── Chart helpers ───────────────────────────────────────
    useEffect(() => {
        if (page !== 'dream' || !currentDreamId) return;
        const dream = getDream(currentDreamId);
        if (!dream) return;
        import('chart.js').then(({ Chart, registerables }) => {
            Chart.register(...registerables);
            // Daily chart
            if (dailyChartRef.current) {
                if (dailyChartInst.current) dailyChartInst.current.destroy();
                const dailyData = calcDailyProgress(dream, currentYear, currentMonth);
                dailyChartInst.current = new Chart(dailyChartRef.current, {
                    type: 'line',
                    data: { labels: dailyData.map(d => d.day), datasets: [{ label: 'Daily %', data: dailyData.map(d => d.pct), borderColor: '#4A7CFF', backgroundColor: 'rgba(74,124,255,0.08)', borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#4A7CFF', pointBorderColor: '#fff', pointBorderWidth: 2 }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11, family: 'Inter' }, color: '#9CA3B4' }, grid: { color: '#F0F2F5' } }, x: { ticks: { font: { size: 10, family: 'Inter' }, color: '#9CA3B4' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
                });
            }
        });
    }, [page, currentDreamId, currentYear, currentMonth, appData]);

    useEffect(() => {
        if (page !== 'dashboard') return;
        import('chart.js').then(({ Chart, registerables }) => {
            Chart.register(...registerables);
            const now = new Date();
            const yr = now.getFullYear(), mo = now.getMonth();
            const days = daysInMonth(yr, mo);
            const mk = monthKey(yr, mo);

            // Gather dream stats
            const dreamStats = appData.dreams.map(dream => {
                let dreamDone = 0, dreamTotal = 0;
                dream.habits.forEach(h => {
                    const done = Object.values(h.tracking[mk] || {}).filter(v => v === true).length;
                    const goal = getHabitGoal(h, mk, days);
                    dreamDone += done; dreamTotal += goal;
                });
                return { id: dream.id, title: dream.title, done: dreamDone, total: dreamTotal, pct: dreamTotal > 0 ? Math.round((dreamDone / dreamTotal) * 100) : 0 };
            });

            // Pie chart
            if (pieChartRef.current) {
                if (pieChartInst.current) pieChartInst.current.destroy();
                const colors = ['#4A7CFF', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
                pieChartInst.current = new Chart(pieChartRef.current, {
                    type: 'doughnut',
                    data: { labels: dreamStats.map(d => d.title), datasets: [{ data: dreamStats.map(d => d.done || 1), backgroundColor: dreamStats.map((_, i) => colors[i % colors.length]), borderWidth: 0, hoverOffset: 8 }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, font: { family: 'Inter', size: 11 }, color: '#6B7280' } } } }
                });
            }

            // Weekly trend chart
            if (weeklyChartRef.current) {
                if (weeklyChartInst.current) weeklyChartInst.current.destroy();
                const weeklyData = getWeeklyPcts(appData, yr, mo);
                const gradient = weeklyChartRef.current.getContext('2d').createLinearGradient(0, 0, 0, 200);
                gradient.addColorStop(0, 'rgba(74,124,255,0.2)');
                gradient.addColorStop(1, 'rgba(74,124,255,0)');
                weeklyChartInst.current = new Chart(weeklyChartRef.current, {
                    type: 'line',
                    data: { labels: weeklyData.map(w => w.label), datasets: [{ label: 'Completion %', data: weeklyData.map(w => w.pct), borderColor: '#4A7CFF', backgroundColor: gradient, fill: true, tension: 0.4, borderWidth: 3, pointBackgroundColor: '#fff', pointBorderColor: '#4A7CFF', pointBorderWidth: 3, pointRadius: 6 }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11, family: 'Inter' }, color: '#9CA3B4' } }, x: { ticks: { font: { size: 10, family: 'Inter' }, color: '#9CA3B4' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
                });
            }

            // Performance chart
            if (perfChartRef.current) {
                if (perfChartInst.current) perfChartInst.current.destroy();
                const labels = [], data = [];
                for (let d = 1; d <= days; d++) {
                    labels.push(d);
                    let dayTotal = 0, dayDone = 0;
                    appData.dreams.forEach(dream => {
                        dream.habits.forEach(h => {
                            const goal = getHabitGoal(h, mk, days);
                            if (goal === 0) return;
                            dayTotal++;
                            if ((h.tracking[mk] || {})[d] === true) dayDone++;
                        });
                    });
                    data.push(dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0);
                }
                perfChartInst.current = new Chart(perfChartRef.current, {
                    type: 'bar',
                    data: { labels, datasets: [{ label: 'Daily %', data, backgroundColor: data.map(v => v === 100 ? 'rgba(34,197,94,0.7)' : v > 0 ? 'rgba(74,124,255,0.5)' : 'rgba(0,0,0,0.05)'), borderRadius: 4 }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11, family: 'Inter' }, color: '#9CA3B4' } }, x: { ticks: { font: { size: 10, family: 'Inter' }, color: '#9CA3B4' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
                });
            }
        });
    }, [page, appData]);

    // ─── Render: Dreams Grid ─────────────────────────────────
    function DreamsGrid() {
        if (appData.dreams.length === 0) return (
            <div className="empty-state">
                <div className="empty-icon">🌟</div>
                <h3>No dreams yet</h3>
                <p>Start by adding your first dream and give it momentum.</p>
                <button className="app-btn app-btn-primary" onClick={() => { setEditingDreamId(null); openDreamModal(); }}>Add Your First Dream</button>
            </div>
        );
        return (
            <div className="dreams-grid">
                {appData.dreams.map(dream => {
                    const pct = calcDreamProgress(dream, currentYear, currentMonth);
                    return (
                        <div className="dream-card" key={dream.id} onClick={() => { setCurrentDreamId(dream.id); setPage('dream'); }}>
                            <div className="dream-card-title">{dream.title}</div>
                            <div className="dream-card-progress">
                                <div className="dream-card-bar"><div className="dream-card-bar-fill" style={{ width: pct + '%' }} /></div>
                                <span className="dream-card-pct">{pct}%</span>
                            </div>
                            <div className="dream-card-actions">
                                <button className="dream-card-btn open" onClick={e => { e.stopPropagation(); setCurrentDreamId(dream.id); setPage('dream'); }}>Open Plan</button>
                                <button className="dream-card-btn edit" onClick={e => { e.stopPropagation(); setEditingDreamId(dream.id); openDreamModal(dream.title); }}>Edit</button>
                                <button className="dream-card-btn delete" onClick={e => { e.stopPropagation(); setDeletingType('dream'); setDeletingId(dream.id); setConfirmMsg(`Delete "${dream.title}"? This cannot be undone.`); setConfirmOpen(true); }}>Delete</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // ─── Render: Habit Grid ──────────────────────────────────
    function HabitGrid({ dream }) {
        const days = daysInMonth(currentYear, currentMonth);
        const mk = monthKey(currentYear, currentMonth);
        if (dream.habits.length === 0) return (
            <div className="empty-state"><div className="empty-icon">📋</div><h3>No habits yet</h3><p>Add habits to start tracking your execution.</p></div>
        );
        return (
            <div className="habit-tracker-wrapper">
                <div className="habit-grid-container" style={{ overflowX: 'auto' }}>
                    <table className="habit-grid">
                        <thead>
                            <tr>
                                <th className="habit-name-col">Habit</th>
                                <th className="goal-col">Goal</th>
                                {Array.from({ length: days }, (_, i) => <th key={i + 1} className="day-header">{i + 1}</th>)}
                                <th className="progress-col">Done</th>
                                <th className="progress-end-col">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dream.habits.map(habit => {
                                const progress = calcHabitProgress(habit, currentYear, currentMonth);
                                const tracking = habit.tracking[mk] || {};
                                const pctClamped = Math.min(progress.pct, 100);
                                const barColor = pctClamped === 100 ? 'var(--green)' : 'var(--blue)';
                                return (
                                    <tr key={habit.id}>
                                        <td className="habit-name-cell">
                                            <div className="habit-name-inner">
                                                <span>{habit.name}</span>
                                                <button className="habit-delete-btn" title="Delete" onClick={() => { setDeletingType('habit'); setDeletingId(habit.id); setConfirmMsg(`Delete habit "${habit.name}"?`); setConfirmOpen(true); }}>✕</button>
                                            </div>
                                        </td>
                                        <td className="goal-col">
                                            <input type="number" className="goal-input" defaultValue={progress.goal} min="0" max={days}
                                                onChange={e => { let v = parseInt(e.target.value); if (isNaN(v) || v < 0) v = 0; if (v > days) v = days; e.target.value = v; setHabitGoal(currentDreamId, habit.id, mk, v); }} />
                                        </td>
                                        {Array.from({ length: days }, (_, i) => {
                                            const d = i + 1;
                                            if (progress.goal === 0) return <td key={d}><span className="day-na">NA</span></td>;
                                            const val = tracking[d];
                                            const stateClass = val === true ? 'state-done' : val === 'na' ? 'state-na' : 'state-empty';
                                            const label = val === true ? '\u2713' : val === 'na' ? 'NA' : '';
                                            return <td key={d}><button className={`day-tri ${stateClass}`} onClick={() => cycleHabitDay(currentDreamId, habit.id, mk, d)}>{label}</button></td>;
                                        })}
                                        <td className="progress-col">{progress.goal === 0 ? 0 : progress.done}</td>
                                        <td className="progress-end-col">
                                            {progress.goal === 0 ? <span className="habit-progress-text" style={{ color: 'var(--text-muted)' }}><b>N/A</b></span> : (
                                                <div className="habit-progress-visual">
                                                    <div className="habit-progress-bar-bg"><div className="habit-progress-bar-fg" style={{ width: pctClamped + '%', background: barColor }} /></div>
                                                    <span className="habit-progress-text">{progress.done}/{progress.goal} <b>{progress.pct}%</b></span>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Daily % row */}
                            <tr className="daily-summary-row">
                                <td className="habit-name-cell" style={{ fontWeight: 700 }}>Daily %</td>
                                <td className="goal-col"></td>
                                {calcDailyProgress(dream, currentYear, currentMonth).map(d => (
                                    <td key={d.day}><span className={`daily-pct ${d.pct === 100 ? 'full' : d.pct > 0 ? 'partial' : 'zero'}`}>{d.pct}%</span></td>
                                ))}
                                <td className="progress-col"></td>
                                <td className="progress-end-col"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // ─── Render: Dream Detail ────────────────────────────────
    function DreamDetail() {
        const dream = getDream(currentDreamId);
        if (!dream) { setPage('landing'); return null; }
        const pct = calcDreamProgress(dream, currentYear, currentMonth);
        const streaks = calcStreaks(dream, currentYear, currentMonth);
        const dailyData = calcDailyProgress(dream, currentYear, currentMonth);
        const activeDays = dailyData.filter(d => d.pct > 0).length;
        const totalDays = daysInMonth(currentYear, currentMonth);
        const consistency = totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        return (
            <>
                <div className="dream-header">
                    <button className="btn-back" onClick={() => setPage('landing')}>
                        ← Back to Dreams
                    </button>
                    <div className="dream-title-row">
                        <div className="dream-switcher-wrapper">
                            <select className="dream-switcher" value={currentDreamId} onChange={e => setCurrentDreamId(e.target.value)}>
                                {appData.dreams.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                            </select>
                            <svg className="dream-switcher-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                        </div>
                    </div>
                    <div className="month-picker-row">
                        <div className="current-month-label">{monthNames[currentMonth]} {currentYear}</div>
                        <div className="month-picker">
                            <div className="year-selector">
                                <button className="app-btn-icon-sm" onClick={() => setCurrentYear(y => y - 1)}>‹</button>
                                <span className="year-label">{currentYear}</span>
                                <button className="app-btn-icon-sm" onClick={() => setCurrentYear(y => y + 1)}>›</button>
                            </div>
                            <div className="month-grid">
                                {shortMonths.map((m, i) => (
                                    <button key={m} className={`month-btn${i === currentMonth ? ' active' : ''}`} onClick={() => setCurrentMonth(i)}>{m}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="main-progress-wrapper">
                        <div className="main-progress-bar">
                            <div className="main-progress-fill" style={{ width: Math.max(pct, 5) + '%' }}>
                                <span className="main-progress-text">{pct}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="execution-section">
                    <div className="section-header">
                        <h2 className="section-title-app">Execution Plan <span style={{ fontWeight: 600, color: 'var(--blue)', fontSize: '0.85em', marginLeft: 8 }}>– {monthNames[currentMonth]} {currentYear}</span></h2>
                        <button className="app-btn app-btn-primary app-btn-sm" onClick={() => { setHabitModalValue(''); setHabitModalOpen(true); }}>+ Add Habit</button>
                    </div>
                    <HabitGrid dream={dream} />
                </div>

                <div className="daily-summary-section">
                    <h3 className="subsection-title">Daily Progress</h3>
                    <div className="daily-chart-wrapper"><canvas ref={dailyChartRef} /></div>
                </div>

                <div className="monthly-summary">
                    <h3 className="subsection-title">Monthly Summary</h3>
                    <div className="stats-grid">
                        <div className="stat-card"><div className="stat-value">{totalDays}</div><div className="stat-label">Total Days</div></div>
                        <div className="stat-card"><div className="stat-value">{streaks.completedDays}</div><div className="stat-label">Completed Days</div></div>
                        <div className="stat-card"><div className="stat-value">{pct}%</div><div className="stat-label">Completion</div></div>
                        <div className="stat-card"><div className="stat-value">{streaks.longestStreak}</div><div className="stat-label">Longest Streak</div></div>
                        <div className="stat-card"><div className="stat-value">{consistency}%</div><div className="stat-label">Consistency</div></div>
                    </div>
                </div>

                <div className="motivation-banner"><p>&ldquo;Small habits. Massive transformation.&rdquo;</p></div>
            </>
        );
    }

    // ─── Render: Dashboard ───────────────────────────────────
    function Dashboard() {
        const now = new Date();
        const yr = now.getFullYear(), mo = now.getMonth();
        const days = daysInMonth(yr, mo);
        const mk = monthKey(yr, mo);
        const today = now.getDate();

        let totalChecks = 0, possibleChecks = 0, bestStreak = 0, bestStreakHabit = '';
        const dreamStats = [];
        const habitStats = [];

        appData.dreams.forEach(dream => {
            let dreamDone = 0, dreamTotal = 0;
            dream.habits.forEach(h => {
                const tracking = h.tracking[mk] || {};
                const done = Object.values(tracking).filter(v => v === true).length;
                const goal = getHabitGoal(h, mk, days);
                totalChecks += done; possibleChecks += goal;
                dreamDone += done; dreamTotal += goal;
                let cs = 0, bs = 0;
                for (let d = 1; d <= days; d++) {
                    if (tracking[d] === true) { cs++; if (cs > bs) bs = cs; }
                    else if (tracking[d] !== 'na') cs = 0;
                }
                habitStats.push({ name: h.name, dreamTitle: dream.title, done, total: goal, pct: goal > 0 ? Math.round((done / goal) * 100) : 0, streak: bs });
            });
            const streaks = calcStreaks(dream, yr, mo);
            if (streaks.longestStreak > bestStreak) { bestStreak = streaks.longestStreak; bestStreakHabit = streaks.bestHabitName; }
            dreamStats.push({ id: dream.id, title: dream.title, done: dreamDone, total: dreamTotal, pct: dreamTotal > 0 ? Math.round((dreamDone / dreamTotal) * 100) : 0 });
        });

        const overallPct = possibleChecks > 0 ? Math.round((totalChecks / possibleChecks) * 100) : 0;
        let todayDone = 0, todayTotal = 0;
        appData.dreams.forEach(dream => {
            dream.habits.forEach(h => {
                const goal = getHabitGoal(h, mk, days);
                if (goal === 0) return;
                todayTotal++;
                const val = (h.tracking[mk] || {})[today];
                if (val === true || val === 'na') todayDone++;
            });
        });
        const todayPct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0;
        const focusDream = dreamStats.reduce((b, d) => (d.done > (b ? b.done : -1)) ? d : b, null);
        const focusContrib = focusDream && totalChecks > 0 ? Math.round((focusDream.done / totalChecks) * 100) : 0;
        const momentum = calcMomentumScore(appData, yr, mo, overallPct, bestStreak);
        const momentumRating = momentum >= 85 ? 'ELITE' : momentum >= 70 ? 'GREAT' : momentum >= 50 ? 'GOOD' : momentum >= 30 ? 'BUILDING' : 'STARTING';
        const topStreaks = [...habitStats].sort((a, b) => b.streak - a.streak).slice(0, 3);
        const topHabits = [...habitStats].sort((a, b) => b.pct - a.pct).slice(0, 5);
        const sortedDreams = [...appData.dreams].map(dream => ({ dream, pct: calcDreamProgress(dream, yr, mo) })).sort((a, b) => b.pct - a.pct);

        // Heatmap
        const heatmapCells = [];
        for (let d = 1; d <= days; d++) {
            let dayTotal = 0, dayDone = 0;
            appData.dreams.forEach(dream => {
                dream.habits.forEach(h => {
                    const goal = getHabitGoal(h, mk, days);
                    if (goal === 0) return;
                    dayTotal++;
                    const val = (h.tracking[mk] || {})[d];
                    if (val === true || val === 'na') dayDone++;
                });
            });
            const pct = dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0;
            const level = pct === 100 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : pct > 0 ? 1 : 0;
            heatmapCells.push({ d, pct, level });
        }

        // Achievements
        const badges = [
            { icon: '🔥', name: 'First Spark', desc: '1-day streak', unlocked: bestStreak >= 1 },
            { icon: '⚡', name: 'Triple Threat', desc: '3-day streak', unlocked: bestStreak >= 3 },
            { icon: '🗓️', name: 'Week Warrior', desc: '7-day streak', unlocked: bestStreak >= 7 },
            { icon: '💪', name: 'Unstoppable', desc: '14-day streak', unlocked: bestStreak >= 14 },
            { icon: '🏆', name: 'Legend', desc: '30-day streak', unlocked: bestStreak >= 30 },
            { icon: '💯', name: 'Perfectionist', desc: '100% today', unlocked: todayPct === 100 },
            { icon: '🎯', name: 'Half Way', desc: '50% monthly', unlocked: overallPct >= 50 },
            { icon: '🚀', name: 'Momentum Master', desc: 'Score > 80', unlocked: momentum > 80 },
        ];

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        return (
            <>
                <div className="dashboard-header">
                    <h1 className="dashboard-title">Momentum Dashboard</h1>
                    <p className="dashboard-sub">Your analytics command center</p>
                </div>

                {/* Stats */}
                <div className="dash-stats-grid">
                    <div className="stat-card stat-card-momentum">
                        <div className="stat-icon">◆</div>
                        <div className="stat-value">{momentum}<small>/100</small></div>
                        <div className="stat-sub">{momentumRating} PERFORMANCE</div>
                        <div className="stat-label">Momentum Score</div>
                        <div className="momentum-tooltip"><h4>Momentum Analysis</h4><ul><li><strong>Completion:</strong> {overallPct}%</li><li><strong>Best Streak:</strong> {bestStreak} days</li><li><strong>Today:</strong> {todayPct}%</li></ul></div>
                    </div>
                    <div className="stat-card stat-card-streak">
                        <div className="stat-icon">🔥</div>
                        <div className="stat-value">{bestStreak}</div>
                         <div className="stat-sub"></div>
                        <div className="stat-label">Best Streak</div>
                        <div className="momentum-tooltip streak-tooltip"><h4>Top 3 Streaks</h4><ul>{topStreaks.map(s => <li key={s.name}><strong>{s.streak} days</strong> in {s.name}</li>)}</ul></div>
                    </div>
                    <div className="stat-card stat-card-today">
                        <div className="stat-icon">✦</div>
                        <div className="stat-value">{todayPct}%</div>
                        <div className="stat-label">Today&apos;s Completion</div>
                    </div>
                    <div className="stat-card stat-card-focus">
                        <div className="stat-icon">⭐</div>
                        <div className="stat-value">{focusDream ? focusDream.title.slice(0, 15) + (focusDream.title.length > 15 ? '…' : '') : '—'}</div>
                        <div className="stat-sub">{focusDream ? focusContrib + '% of your energy' : ''}</div>
                        <div className="stat-label">Focus Dream</div>
                    </div>
                </div>

                {/* Charts */}
                <div className="dash-charts-row" style={{ maxWidth: 1100, margin: '0 auto 20px', padding: '0 24px' }}>
                    <div className="dash-card" style={{ margin: 0 }}>
                        <h3 className="dash-card-title">Dream Contribution</h3>
                        <div className="chart-wrapper chart-wrapper-pie"><canvas ref={pieChartRef} /></div>
                    </div>
                    <div className="dash-card" style={{ margin: 0 }}>
                        <h3 className="dash-card-title">Weekly Growth Trend</h3>
                        <div className="chart-wrapper chart-wrapper-line"><canvas ref={weeklyChartRef} /></div>
                    </div>
                </div>

                {/* Heatmap */}
                <div className="dash-card">
                    <h3 className="dash-card-title">Consistency Heatmap</h3>
                    <div className="heatmap-container">
                        <div className="heatmap-label">{monthNames[mo]} {yr}</div>
                        <div className="heatmap-grid">
                            {heatmapCells.map(({ d, pct, level }) => (
                                <div key={d} className={`heatmap-cell level-${level}`} title={`Day ${d}: ${pct}%`}>
                                    <span className="heatmap-day">{d}</span>
                                </div>
                            ))}
                        </div>
                        <div className="heatmap-legend">
                            <div className="heatmap-legend-info"><span>Lower consistency</span><span>Higher consistency</span></div>
                            <div className="heatmap-legend-cells">{[0, 1, 2, 3, 4].map(l => <div key={l} className={`heatmap-cell-mini level-${l}`} />)}</div>
                        </div>
                    </div>
                </div>

                {/* Insights + Top Habits */}
                <div className="dash-charts-row" style={{ maxWidth: 1100, margin: '0 auto 20px', padding: '0 24px' }}>
                    <div className="dash-card" style={{ margin: 0 }}>
                        <h3 className="dash-card-title">🧠 Smart Insights</h3>
                        <div className="insights-list">
                            {overallPct > 0 ? <div className="insight-row insight-positive"><span className="insight-icon">📊</span><span className="insight-text">Monthly completion: <strong>{overallPct}%</strong></span></div> : null}
                            {bestStreak >= 3 ? <div className="insight-row insight-positive"><span className="insight-icon">🔥</span><span className="insight-text"><strong>{bestStreak}-day</strong> streak in <strong>{bestStreakHabit}</strong>!</span></div> : null}
                            {todayPct >= 100 ? <div className="insight-row insight-positive"><span className="insight-icon">💯</span><span className="insight-text"><strong>Perfect today!</strong> Keep this momentum up.</span></div> : null}
                            {todayPct === 0 && todayTotal > 0 ? <div className="insight-row insight-warning"><span className="insight-icon">⚠️</span><span className="insight-text">No habits completed today. Start now!</span></div> : null}
                            {appData.dreams.length === 0 ? <div className="insight-row insight-neutral"><span className="insight-icon">💡</span><span className="insight-text">Start tracking habits to unlock personalized insights!</span></div> : null}
                        </div>
                    </div>
                    <div className="dash-card" style={{ margin: 0 }}>
                        <h3 className="dash-card-title">Top 5 Habits</h3>
                        <div className="top-habits-list">
                            {topHabits.length === 0 ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No habits tracked yet.</p> : topHabits.map((h, i) => (
                                <div className="top-habit-row" key={h.name}>
                                    <span className="top-habit-rank">{i + 1}</span>
                                    <div className="top-habit-info">
                                        <div className="top-habit-name-wrapper">
                                            <div className="top-habit-name">{h.name}</div>
                                            {h.pct === 100 && <span className="status-badge status-success">PERFECT</span>}
                                            {h.pct >= 80 && h.pct < 100 && <span className="status-badge status-info">ON TRACK</span>}
                                        </div>
                                        <div className="top-habit-dream">{h.dreamTitle}</div>
                                    </div>
                                    <div className="top-habit-progress">
                                        <div className="top-habit-bar"><div className="top-habit-bar-fill" style={{ width: Math.min(h.pct, 100) + '%', background: h.pct === 100 ? 'var(--green)' : 'var(--blue)' }} /></div>
                                        <span className="top-habit-pct">{h.pct}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Dreams Progress */}
                <div className="dash-card">
                    <h3 className="dash-card-title">All Dreams Progress</h3>
                    <div className="dreams-comparison">
                        {sortedDreams.map(({ dream, pct }) => {
                            const streaks = calcStreaks(dream, yr, mo);
                            return (
                                <div className="dream-compare-card" key={dream.id} onClick={() => { setCurrentDreamId(dream.id); setPage('dream'); }}>
                                    <div className="dream-compare-left">
                                        <div className="dream-compare-title">{dream.title}</div>
                                        <span className="dream-compare-meta">{dream.habits.length} habits · {streaks.longestStreak}🔥 streak</span>
                                    </div>
                                    <div className="dream-compare-right">
                                        <div className="dream-compare-bar"><div className="dream-compare-bar-fill" style={{ width: pct + '%' }} /></div>
                                        <span className="dream-compare-pct">{pct}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Achievements */}
                <div className="dash-card">
                    <h3 className="dash-card-title">🏆 Achievements</h3>
                    <div className="achievements-grid">
                        {badges.map(b => (
                            <div key={b.name} className={`badge-card ${b.unlocked ? 'badge-unlocked' : 'badge-locked'}`}>
                                <div className="badge-icon">{b.unlocked ? b.icon : '🔒'}</div>
                                <div className="badge-name">{b.name}</div>
                                <div className="badge-desc">{b.desc}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Performance Graph */}
                <div className="dash-card">
                    <h3 className="dash-card-title">Performance Graph</h3>
                    <div className="chart-wrapper"><canvas ref={perfChartRef} /></div>
                </div>

                <div className="motivation-banner"><p>&ldquo;Consistency creates power. Momentum builds greatness.&rdquo;</p></div>
            </>
        );
    }

    // ─── Main Render ─────────────────────────────────────────
    return (
        <>
            <Navbar user={user} onLogout={handleLogout} currentPage={page} onNavigate={p => { if (p === 'landing') { setPage('landing'); } else if (p === 'map') { setPage('map'); } else if (p === 'dashboard') { setPage('dashboard'); } }} />

            {/* Dreams Page */}
            <section className={`page${page === 'landing' ? ' active' : ''}`}>
                <div className="section-dreams">
                    <div className="section-header">
                        <div>
                            <h2 className="section-title-app">Your Dreams</h2>
                            <p className="section-subtitle-app">Dreams of Your Life</p>
                        </div>
                        <button className="app-btn app-btn-primary" onClick={() => { setEditingDreamId(null); openDreamModal(); }}>+ Add Dream</button>
                    </div>
                    <DreamsGrid />
                </div>
                <div className="motivation-banner"><p>&ldquo;You don&apos;t rise to the level of your dreams. You fall to the level of your systems.&rdquo;</p></div>
            </section>

            {/* Map Your Day Page */}
            <section className={`page${page === 'map' ? ' active' : ''}`}>
                {page === 'map' && <MapYourDay appData={appData} persist={persist} onNavigate={setPage} />}
            </section>

            {/* Dream Detail Page */}
            <section className={`page${page === 'dream' ? ' active' : ''}`}>
                {page === 'dream' && <DreamDetail />}
            </section>

            {/* Dashboard Page */}
            <section className={`page${page === 'dashboard' ? ' active' : ''}`}>
                {page === 'dashboard' && <Dashboard />}
            </section>

            {/* Footer */}
            <footer className="footer">
                <p className="footer-quote">Your future is built daily.<br /><strong>Keep moving.</strong></p>
                <p className="footer-brand">◆ Momentum</p>
            </footer>

            {/* === MODALS === */}
            <Modal open={dreamModalOpen} onClose={() => setDreamModalOpen(false)} title={editingDreamId ? 'Edit Dream' : 'Add Dream'}
                footer={<>
                    <button className="app-btn app-btn-secondary" onClick={() => setDreamModalOpen(false)}>Cancel</button>
                    <button className="app-btn app-btn-primary" onClick={saveDream}>Save Dream</button>
                </>}>
                <label className="input-label">Dream Title</label>
                <input className="input-field" type="text" placeholder="e.g. Run 42.195 KM" maxLength={60}
                    value={dreamModalTitle} onChange={e => setDreamModalTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveDream(); }}
                    autoFocus />
            </Modal>

            <Modal open={habitModalOpen} onClose={() => setHabitModalOpen(false)} title="Add Habit"
                footer={<>
                    <button className="app-btn app-btn-secondary" onClick={() => setHabitModalOpen(false)}>Cancel</button>
                    <button className="app-btn app-btn-primary" onClick={saveHabit}>Add Habit</button>
                </>}>
                <label className="input-label">Habit Name</label>
                <input className="input-field" type="text" placeholder="e.g. Morning Run" maxLength={40}
                    value={habitModalValue} onChange={e => setHabitModalValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveHabit(); }}
                    autoFocus />
            </Modal>

            <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm Delete"
                footer={<>
                    <button className="app-btn app-btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
                    <button className="app-btn app-btn-danger" onClick={confirmDelete}>Delete</button>
                </>}>
                <p>{confirmMsg}</p>
            </Modal>
        </>
    );
}
