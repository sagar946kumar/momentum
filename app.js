/* ===================================
   MOMENTUM – Application Logic
   =================================== */

import { createClient } from '@supabase/supabase-js';

(function () {
  'use strict';

  // ─── Data Layer (Supabase + Local Fallback) ───────────────────
  let STORAGE_KEY = 'momentum_data'; // Will be updated with userId
  const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'YOUR_SUPABASE_URL';
  const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

  let supabaseClient = null;
  try {
    if (SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) { console.error("Supabase init error:", e); }

  async function loadData() {
    // 1. Try to load from Supabase if logged in
    const user = JSON.parse(localStorage.getItem('user'));
    if (supabaseClient && user && user.isLoggedIn) {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
          const { data, error } = await supabaseClient
            .from('user_data')
            .select('dreams, is_premium')
            .eq('id', session.user.id)
            .single();

          if (data) {
            console.log("Loaded from Supabase");
            // Also sync premium status to local user object
            if (data.is_premium) {
              user.isPremium = true;
              localStorage.setItem('user', JSON.stringify(user));
            }
            return { dreams: data.dreams || [], is_premium: data.is_premium || false };
          }
        }
      } catch (e) { console.error("Supabase load error:", e); }
    }

    // 2. Fallback to LocalStorage (User-Specific)
    try {
      if (user && user.isLoggedIn) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) STORAGE_KEY = 'momentum_data_' + session.user.id;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { dreams: [] };
  }

  async function saveData(data) {
    // Save to LocalStorage first (instant feedback)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    // Sync with Supabase in background
    const user = JSON.parse(localStorage.getItem('user'));
    if (supabaseClient && user && user.isLoggedIn) {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
          await supabaseClient
            .from('user_data')
            .upsert({
              id: session.user.id,
              dreams: data.dreams,
              is_premium: user.isPremium || false,
              updated_at: new Date().toISOString()
            });
          console.log("Synced to Supabase (including premium status)");
        }
      } catch (e) { console.error("Supabase sync error:", e); }
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let appData = { dreams: [] };

  // ─── State ─────────────────────────────────────────────────
  let currentDreamId = null;
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth(); // 0-indexed
  let editingDreamId = null;
  let editingHabitId = null;
  let deletingType = null;  // 'dream' | 'habit'
  let deletingId = null;
  let dailyChart = null;
  let perfChart = null;
  let pieChart = null;
  let weeklyChart = null;
  let mapActiveDropdown = null;
  let mapEditingSlot = null;

  // ─── DOM Refs ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pages = {
    landing: $('#page-landing'),
    dream: $('#page-dream'),
    map: $('#page-map'),
    dashboard: $('#page-dashboard'),
    more: $('#page-more'),
  };

  // ─── Router ────────────────────────────────────────────────
  function navigate(hash) {
    if (hash && !hash.startsWith('#')) hash = '#' + hash;
    window.location.hash = hash || '#landing';
  }

  function handleRoute() {
    const hash = window.location.hash || '#landing';
    const parts = hash.replace('#', '').split('/');
    const page = parts[0] || 'landing';

    // Hide all
    Object.values(pages).forEach(p => p.classList.remove('active'));

    // Update nav links
    $$('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.page === page || (page === 'dream' && l.dataset.page === 'landing'));
    });

    switch (page) {
      case 'dream':
        currentDreamId = parts[1] || null;
        pages.dream.classList.add('active');
        renderDreamPage();
        break;
      case 'map':
        pages.map.classList.add('active');
        renderMapPage();
        break;
      case 'dashboard':
        pages.dashboard.classList.add('active');
        renderDashboard();
        break;
      case 'more':
        pages.more.classList.add('active');
        break;
      default:
        pages.landing.classList.add('active');
        renderDreamsGrid();
        break;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('hashchange', handleRoute);

  // Handle click outside to close dropdowns
  window.addEventListener('click', (e) => {
    if (mapActiveDropdown && !e.target.closest('.timeline-slot-dropdown-wrapper') && !e.target.closest('.timeline-slot-empty-btn')) {
      mapActiveDropdown = null;
      renderMapPage();
    }
  });

  // ─── Map Your Day Visual Flow System ──────────────────────────
  let mydFlowState = {
    date: new Date().toDateString(),
    rootTaskIds: [],
    tasks: {}
  };
  let mydTodoOpen = false;
  let mydTodoContext = null;
  let mydSelectedTasks = [];
  let resizeBound = false;

  function loadMydState() {
    const key = `myd_flow_${new Date().toDateString()}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        mydFlowState = JSON.parse(saved);
        
        // Migrate legacy tree data to linear layout
        if (mydFlowState.children && Object.keys(mydFlowState.children).length > 0) {
          const list = [];
          function traverse(id) {
            if (!id) return;
            if (mydFlowState.tasks[id]) list.push(id);
            const childs = mydFlowState.children[id] || [];
            childs.forEach(traverse);
          }
          (mydFlowState.rootTaskIds || []).forEach(traverse);
          mydFlowState.rootTaskIds = list;
          delete mydFlowState.children;
          saveMydState();
        }
        return;
      }
    } catch (e) {
      console.error("Error loading MYD state:", e);
    }
    mydFlowState = {
      date: new Date().toDateString(),
      rootTaskIds: [],
      tasks: {}
    };
  }

  function saveMydState() {
    const key = `myd_flow_${new Date().toDateString()}`;
    try {
      localStorage.setItem(key, JSON.stringify(mydFlowState));
    } catch (e) {
      console.error("Error saving MYD state:", e);
    }
  }

  function getMydAvailableTasks() {
    const allHabits = [];
    (appData.dreams || []).forEach(d => {
      (d.habits || []).forEach(h => {
        allHabits.push({
          id: `dream_${d.id}_${h.id}`,
          name: h.name,
          dreamTitle: d.isSystem ? "Custom Tasks" : d.title,
          sourceId: h.id,
          dreamId: d.id
        });
      });
    });

    const usedNames = new Set(Object.values(mydFlowState.tasks).map(t => t.name));
    return allHabits.filter(h => !usedNames.has(h.name));
  }

  // Ticker for running sessions
  setInterval(() => {
    if (pages.map && pages.map.classList.contains('active')) {
      const hasRunningTasks = Object.values(mydFlowState.tasks).some(t => t.status === 'running');
      if (hasRunningTasks) {
        renderMydCanvas();
        updateMydStats();
      }
    }
  }, 1000);

  function getMydColumnCount() {
    const w = window.innerWidth;
    if (w < 640) return 1;
    if (w < 960) return 2;
    if (w < 1280) return 3;
    return 4;
  }

  function renderMapPage() {
    loadMydState();
    
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    $('#myd-page-sub-date').textContent = dateStr;
    $('#myd-canvas-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    
    renderMydCanvas();
    updateMydStats();
    setupMydEventListeners();

    if (!resizeBound) {
      window.addEventListener('resize', () => {
        if (pages.map && pages.map.classList.contains('active')) {
          renderMydCanvas();
        }
      });
      resizeBound = true;
    }
  }

  function renderMydCanvas() {
    const $branchesContainer = $('#myd-flow-branches-container');
    if (!mydFlowState.rootTaskIds) {
      mydFlowState.rootTaskIds = [];
    }

    const N = getMydColumnCount();
    const gridItems = [
      { type: 'todo' },
      ...mydFlowState.rootTaskIds
        .map(id => mydFlowState.tasks[id])
        .filter(Boolean)
        .map(t => ({ type: 'task', task: t }))
    ];

    let html = `<div class="myd-snake-grid cols-${N}">`;
    gridItems.forEach((item, i) => {
      const row = Math.floor(i / N);
      let col = i % N;
      if (row % 2 === 1) {
        col = N - 1 - col;
      }

      let arrowHtml = '';
      if (i < gridItems.length - 1) {
        const nextRow = Math.floor((i + 1) / N);
        let nextCol = (i + 1) % N;
        if (nextRow % 2 === 1) {
          nextCol = N - 1 - nextCol;
        }

        let dir = 'down';
        if (nextRow === row) {
          dir = nextCol > col ? 'right' : 'left';
        }

        let status = 'inactive';
        if (item.type === 'todo') {
          status = 'active';
        } else if (item.type === 'task') {
          if (item.task.status === 'completed') status = 'completed';
          else if (item.task.status === 'running' || item.task.status === 'paused') status = 'active';
        }

        arrowHtml = `
          <div class="myd-connector-arrow dir-${dir} status-${status}"></div>
        `;
      }

      let itemHtml = '';
      if (item.type === 'todo') {
        const available = getMydAvailableTasks().length;
        itemHtml = `
          <div class="myd-grid-item" style="grid-row: ${row + 1}; grid-column: ${col + 1};">
            <div class="myd-todo-node" id="myd-todo-node-trigger">
              <div class="myd-todo-node-icon">📋</div>
              <div class="myd-todo-node-content">
                <span class="myd-todo-node-title">To-Do List</span>
                <span class="myd-todo-node-count" id="myd-todo-node-text">
                  ${available + gridItems.length - 1} tasks · ${available} remaining
                </span>
              </div>
              <div class="myd-todo-node-cta">Select →</div>
            </div>
            ${arrowHtml}
          </div>
        `;
      } else {
        const task = item.task;
        const cardHtml = renderMydTaskCardHtml(task);
        itemHtml = `
          <div class="myd-grid-item" style="grid-row: ${row + 1}; grid-column: ${col + 1};">
            ${cardHtml}
            ${arrowHtml}
          </div>
        `;
      }

      html += itemHtml;
    });
    html += `</div>`;

    $branchesContainer.innerHTML = html;
    attachMydCanvasInteractions();
  }

  function renderMydTaskCardHtml(task) {
    const isRunning = task.status === 'running';
    const isPaused = task.status === 'paused';
    const isCompleted = task.status === 'completed';

    let totalMs = 0;
    (task.sessions || []).forEach(s => {
      if (s.endTime) {
        totalMs += (new Date(s.endTime) - new Date(s.startTime));
      } else if (isRunning) {
        totalMs += (Date.now() - new Date(s.startTime));
      }
    });
    const totalMin = Math.round(totalMs / 60000);

    let sessionsHtml = '';
    if (task.sessions && task.sessions.length > 0) {
      sessionsHtml = `<ul class="myd-sessions-list">`;
      task.sessions.forEach((s, idx) => {
        const dur = s.endTime 
          ? Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000) 
          : null;
        
        const suffix = idx === 0 ? 'st' : idx === 1 ? 'nd' : idx === 2 ? 'rd' : 'th';
        const sessionLabel = `${idx + 1}${suffix} session`;
        const startStr = fmtMydTime(s.startTime);
        const endStr = s.endTime ? fmtMydTime(s.endTime) : '<span class="myd-session-live">live ●</span>';
        const durHtml = dur !== null ? `<span class="myd-session-dur">${dur} min</span>` : '';

        sessionsHtml += `
          <li class="myd-session-row">
            <span class="myd-session-bullet">•</span>
            <span class="myd-session-label">${sessionLabel}</span>
            <span class="myd-session-time">${startStr}–${endStr}</span>
            ${durHtml}
          </li>
        `;
      });
      sessionsHtml += `</ul>`;
    }

    let controlsHtml = '';
    if (!isCompleted) {
      controlsHtml = `<div class="myd-task-controls">`;
      if (!isRunning && !isPaused) {
        controlsHtml += `
          <button class="myd-btn myd-btn-start myd-task-action-btn" data-action="start" data-task-id="${task.id}" style="width: 100%;">
            ▶ Start
          </button>
        `;
      } else if (isRunning) {
        controlsHtml += `
          <button class="myd-btn myd-btn-pause myd-task-action-btn" data-action="pause" data-task-id="${task.id}" style="flex: 1;">
            ⏸ Pause
          </button>
          <button class="myd-btn myd-btn-complete myd-task-action-btn" data-action="complete" data-task-id="${task.id}" style="flex: 1;">
            ✓ Complete
          </button>
        `;
      } else if (isPaused) {
        controlsHtml += `
          <button class="myd-btn myd-btn-start myd-task-action-btn" data-action="resume" data-task-id="${task.id}" style="flex: 1;">
            ▶ Resume
          </button>
          <button class="myd-btn myd-btn-complete myd-task-action-btn" data-action="complete" data-task-id="${task.id}" style="flex: 1;">
            ✓ Complete
          </button>
        `;
      }
      controlsHtml += `</div>`;
    }

    let statusClass = 'myd-task-active';
    let statusDotClass = '';
    if (isRunning) {
      statusClass = 'myd-task-running';
      statusDotClass = 'dot-run';
    } else if (isPaused) {
      statusClass = 'myd-task-paused';
      statusDotClass = 'dot-pause';
    } else if (isCompleted) {
      statusClass = 'myd-task-completed';
      statusDotClass = 'dot-done';
    }

    let runningIndicatorHtml = '';
    if (isRunning) {
      runningIndicatorHtml = `
        <div class="myd-task-running-indicator">
          <span class="myd-pulse"></span> Recording session…
        </div>
      `;
    } else if (isPaused) {
      runningIndicatorHtml = `
        <div class="myd-task-paused-indicator">
          ⏸ Paused · ${totalMin > 0 ? `${totalMin} min so far` : 'just started'}
        </div>
      `;
    } else if (isCompleted) {
      runningIndicatorHtml = `
        <div class="myd-task-total">
          <span>Total work = ${totalMin} min</span>
        </div>
      `;
    }

    return `
      <div class="myd-task-card ${statusClass}" style="position: relative;">
        <div class="myd-task-card-header" style="position: relative;">
          <div class="myd-task-status-dot ${statusDotClass}"></div>
          <div class="myd-task-name">${escapeHtml(task.name)}</div>
          <button class="myd-task-remove-btn myd-task-action-btn" data-action="remove" data-task-id="${task.id}" title="Remove task from day map">✕</button>
          ${task.dreamTitle ? `<span class="myd-task-dream-badge">${escapeHtml(task.dreamTitle)}</span>` : ''}
        </div>
        
        ${sessionsHtml}
        ${runningIndicatorHtml}
        ${controlsHtml}

        <button class="myd-plus-btn ${isCompleted ? 'myd-plus-btn-completed' : ''} myd-canvas-plus-btn" data-parent-id="${task.id}" title="Add next task" style="position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); z-index: 10;">
          +
        </button>
      </div>
    `;
  }

  function fmtMydTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  }

  function updateMydStats() {
    const tasks = Object.values(mydFlowState.tasks);
    const totalCount = tasks.length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const inFlowCount = tasks.filter(t => t.status !== 'completed').length;

    let totalMs = 0;
    tasks.forEach(t => {
      (t.sessions || []).forEach(s => {
        if (s.endTime) {
          totalMs += (new Date(s.endTime) - new Date(s.startTime));
        } else if (t.status === 'running') {
          totalMs += (Date.now() - new Date(s.startTime));
        }
      });
    });

    const totalSeconds = Math.floor(totalMs / 1000);
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;

    $('#myd-stat-total').textContent = totalCount;
    $('#myd-stat-in-flow').textContent = inFlowCount;
    $('#myd-stat-done').textContent = completedCount;
    $('#myd-stat-time').textContent = `${min}m ${sec}s`;
    
    const available = getMydAvailableTasks().length;
    const $todoNodeText = $('#myd-todo-node-text');
    if ($todoNodeText) {
      $todoNodeText.textContent = `${available + totalCount} tasks · ${available} remaining`;
    }
  }

  function setupMydEventListeners() {
    const $todoClose = $('#myd-todo-modal-close');
    if ($todoClose) $todoClose.onclick = closeMydTodoModal;
    const $todoCancel = $('#myd-todo-modal-cancel');
    if ($todoCancel) $todoCancel.onclick = closeMydTodoModal;

    const $todoDone = $('#myd-todo-modal-done');
    if ($todoDone) $todoDone.onclick = confirmMydTodoSelection;

    const $btnSummary = $('#myd-btn-summary');
    if ($btnSummary) $btnSummary.onclick = openMydSummaryModal;

    const $sumClose = $('#myd-summary-modal-close');
    if ($sumClose) $sumClose.onclick = closeMydSummaryModal;
    const $sumCloseBtn = $('#myd-summary-modal-close-btn');
    if ($sumCloseBtn) $sumCloseBtn.onclick = closeMydSummaryModal;

    const $sumReset = $('#myd-summary-modal-reset');
    if ($sumReset) $sumReset.onclick = resetMydDay;
  }

  function openMydTodoModal(parentId = null) {
    mydTodoContext = parentId;
    mydSelectedTasks = [];
    mydTodoOpen = true;

    const available = getMydAvailableTasks();
    const $todoList = $('#myd-todo-modal-list');
    const $todoSub = $('#myd-todo-modal-sub');
    const $todoDone = $('#myd-todo-modal-done');

    $todoSub.textContent = `${available.length} tasks available · 0 selected`;
    $todoDone.disabled = true;
    $todoDone.textContent = 'Done (0 selected)';

    if (available.length === 0) {
      $todoList.innerHTML = `<div class="myd-empty-state">🎉 All habits and tasks are in the flow!</div>`;
    } else {
      $todoList.innerHTML = available.map(h => `
        <div class="myd-todo-item" data-habit-id="${h.id}">
          <input type="checkbox" class="myd-todo-checkbox" data-habit-id="${h.id}" />
          <div class="myd-todo-info">
            <span class="myd-todo-name">${escapeHtml(h.name)}</span>
            <span class="myd-todo-dream">${escapeHtml(h.dreamTitle)}</span>
          </div>
        </div>
      `).join('');

      $todoList.querySelectorAll('.myd-todo-item').forEach(item => {
        item.onclick = (e) => {
          if (e.target.classList.contains('myd-todo-checkbox')) return;
          const cb = item.querySelector('.myd-todo-checkbox');
          cb.checked = !cb.checked;
          toggleMydTaskSelect(item.dataset.habitId, cb.checked);
        };

        const cb = item.querySelector('.myd-todo-checkbox');
        cb.onclick = (e) => {
          e.stopPropagation();
          toggleMydTaskSelect(item.dataset.habitId, cb.checked);
        };
      });
    }

    $('#myd-todo-modal').style.display = 'flex';
  }

  function toggleMydTaskSelect(habitId, isChecked) {
    if (isChecked) {
      if (!mydSelectedTasks.includes(habitId)) {
        mydSelectedTasks.push(habitId);
      }
    } else {
      mydSelectedTasks = mydSelectedTasks.filter(id => id !== habitId);
    }

    const available = getMydAvailableTasks();
    const $todoSub = $('#myd-todo-modal-sub');
    const $todoDone = $('#myd-todo-modal-done');

    $todoSub.textContent = `${available.length} tasks available · ${mydSelectedTasks.length} selected`;
    $todoDone.disabled = mydSelectedTasks.length === 0;
    $todoDone.textContent = `Done (${mydSelectedTasks.length} selected)`;

    $('#myd-todo-modal-list').querySelectorAll('.myd-todo-item').forEach(item => {
      const id = item.dataset.habitId;
      item.classList.toggle('myd-todo-selected', mydSelectedTasks.includes(id));
    });
  }

  function closeMydTodoModal() {
    mydTodoOpen = false;
    mydTodoContext = null;
    mydSelectedTasks = [];
    $('#myd-todo-modal').style.display = 'none';
  }

  function confirmMydTodoSelection() {
    if (mydSelectedTasks.length === 0) {
      closeMydTodoModal();
      return;
    }

    const available = getMydAvailableTasks();
    const newIds = [];

    mydSelectedTasks.forEach(habitId => {
      const habit = available.find(h => h.id === habitId);
      if (!habit) return;

      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      mydFlowState.tasks[taskId] = {
        id: taskId,
        name: habit.name,
        dreamTitle: habit.dreamTitle,
        dreamId: habit.dreamId,
        habitId: habit.sourceId,
        status: 'active',
        sessions: [],
        addedAt: new Date().toISOString()
      };
      newIds.push(taskId);
    });

    if (!mydFlowState.rootTaskIds) {
      mydFlowState.rootTaskIds = [];
    }

    if (mydTodoContext) {
      const idx = mydFlowState.rootTaskIds.indexOf(mydTodoContext);
      if (idx !== -1) {
        mydFlowState.rootTaskIds.splice(idx + 1, 0, ...newIds);
      } else {
        mydFlowState.rootTaskIds.push(...newIds);
      }
    } else {
      mydFlowState.rootTaskIds.push(...newIds);
    }

    saveMydState();
    closeMydTodoModal();
    renderMapPage();
  }

  function attachMydCanvasInteractions() {
    const $todoTrigger = $('#myd-todo-node-trigger');
    if ($todoTrigger) {
      $todoTrigger.onclick = () => openMydTodoModal(null);
    }

    $$('.myd-canvas-plus-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const parentId = btn.dataset.parentId;
        openMydTodoModal(parentId);
      };
    });

    $$('.myd-task-action-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const taskId = btn.dataset.taskId;
        executeMydSessionAction(taskId, action);
      };
    });
  }

  function executeMydSessionAction(taskId, action) {
    const task = mydFlowState.tasks[taskId];
    if (!task) return;

    const now = new Date().toISOString();
    const wasCompleted = task.status === 'completed';

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

      // Sync completion status to the habit calendar
      if (task.dreamId && task.habitId) {
        const today = new Date().getDate();
        const mk = monthKey(new Date().getFullYear(), new Date().getMonth());
        const dream = appData.dreams.find(d => d.id === task.dreamId);
        if (dream) {
          const habit = dream.habits.find(h => h.id === task.habitId);
          if (habit) {
            if (!habit.tracking[mk]) habit.tracking[mk] = {};
            habit.tracking[mk][today] = true;
            saveData(appData);
          }
        }
      }
    } else if (action === 'remove') {
      mydFlowState.rootTaskIds = mydFlowState.rootTaskIds.filter(id => id !== taskId);
      if (task.status === 'completed' && task.dreamId && task.habitId) {
        const today = new Date().getDate();
        const mk = monthKey(new Date().getFullYear(), new Date().getMonth());
        const dream = appData.dreams.find(d => d.id === task.dreamId);
        if (dream) {
          const habit = dream.habits.find(h => h.id === task.habitId);
          if (habit && habit.tracking[mk]) {
            delete habit.tracking[mk][today];
            saveData(appData);
          }
        }
      }
      delete mydFlowState.tasks[taskId];
    }

    if (wasCompleted && action !== 'complete' && action !== 'remove') {
      if (task.dreamId && task.habitId) {
        const today = new Date().getDate();
        const mk = monthKey(new Date().getFullYear(), new Date().getMonth());
        const dream = appData.dreams.find(d => d.id === task.dreamId);
        if (dream) {
          const habit = dream.habits.find(h => h.id === task.habitId);
          if (habit && habit.tracking[mk]) {
            delete habit.tracking[mk][today];
            saveData(appData);
          }
        }
      }
    }

    saveMydState();
    renderMapPage();
  }

  function openMydSummaryModal() {
    const tasks = Object.values(mydFlowState.tasks);
    const totalCount = tasks.length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;

    let totalMs = 0;
    tasks.forEach(t => {
      (t.sessions || []).forEach(s => {
        if (s.endTime) {
          totalMs += (new Date(s.endTime) - new Date(s.startTime));
        } else if (t.status === 'running') {
          totalMs += (Date.now() - new Date(s.startTime));
        }
      });
    });

    const totalSeconds = Math.floor(totalMs / 1000);
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;

    $('#myd-sum-stat-in-flow').textContent = totalCount - completedCount;
    $('#myd-sum-stat-done').textContent = completedCount;
    $('#myd-sum-stat-time').textContent = `${min}m ${sec}s`;
    $('#myd-sum-stat-total').textContent = totalCount;
    
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    $('#myd-summary-modal-date').textContent = dateStr;

    const $summaryList = $('#myd-summary-modal-list');
    if (tasks.length === 0) {
      $summaryList.innerHTML = `<div class="myd-empty-state">No tasks tracked in the flow map yet today.</div>`;
    } else {
      $summaryList.innerHTML = tasks.map(t => {
        let taskMs = 0;
        (t.sessions || []).forEach(s => {
          if (s.endTime) {
            taskMs += (new Date(s.endTime) - new Date(s.startTime));
          } else if (t.status === 'running') {
            taskMs += (Date.now() - new Date(s.startTime));
          }
        });
        const taskMin = Math.round(taskMs / 60000);
        const statusText = t.status.toUpperCase();
        let statusClass = 'active';
        if (t.status === 'completed') statusClass = 'done';
        else if (t.status === 'running') statusClass = 'running';

        return `
          <div class="myd-summary-task-row">
            <div class="myd-task-status-dot dot-${t.status === 'completed' ? 'done' : t.status === 'running' ? 'run' : 'pause'}"></div>
            <div class="myd-summary-task-name">${escapeHtml(t.name)}</div>
            <div class="myd-summary-task-sessions">${t.sessions ? t.sessions.length : 0} sessions</div>
            <div class="myd-summary-task-time">${taskMin} min</div>
          </div>
        `;
      }).join('');
    }

    $('#myd-summary-modal').style.display = 'flex';
  }

  function closeMydSummaryModal() {
    $('#myd-summary-modal').style.display = 'none';
  }

  function resetMydDay() {
    if (confirm("Are you sure you want to reset today's day map? This will delete all tracked sessions for today.")) {
      mydFlowState = {
        date: new Date().toDateString(),
        rootTaskIds: [],
        tasks: {},
        children: {}
      };
      saveMydState();
      closeMydSummaryModal();
      renderMapPage();
    }
  }

  // ─── Realtime Sync ──────────────────────────────────────────
  async function setupSupabaseRealtime() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!supabaseClient || !user || !user.isLoggedIn) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    console.log("Setting up Supabase Realtime for:", session.user.id);

    // Listen for changes to the user_data table for the current user
    supabaseClient
      .channel('user-data-sync')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'user_data',
          filter: `id=eq.${session.user.id}`
        },
        (payload) => {
          console.log('Realtime change detected:', payload);
          if (payload.new && payload.new.dreams) {
            // Check if data actually changed to avoid infinite loops or unnecessary renders
            const remoteDreams = JSON.stringify(payload.new.dreams);
            const localDreams = JSON.stringify(appData.dreams);

            if (remoteDreams !== localDreams) {
              console.log("Updating local data from Realtime...");
              appData.dreams = payload.new.dreams;
              // Re-save to localstorage for local persistence
              localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
              // Re-render current page to show new data
              handleRoute();
            }
          }
        }
      )
      .subscribe();
  }

  // ─── Dream CRUD ────────────────────────────────────────────
  function addDream(title) {
    const dream = {
      id: generateId(),
      title: title.trim(),
      createdAt: new Date().toISOString(),
      habits: [],
    };
    appData.dreams.push(dream);
    saveData(appData);
    return dream;
  }

  function updateDream(id, title) {
    const dream = appData.dreams.find(d => d.id === id);
    if (dream) {
      dream.title = title.trim();
      saveData(appData);
    }
  }

  function deleteDream(id) {
    appData.dreams = appData.dreams.filter(d => d.id !== id);
    saveData(appData);
  }

  function getDream(id) {
    return appData.dreams.find(d => d.id === id);
  }

  // ─── Habit CRUD ────────────────────────────────────────────
  function addHabit(dreamId, name) {
    const dream = getDream(dreamId);
    if (!dream) return null;

    const now = new Date();
    const mk = monthKey(now.getFullYear(), now.getMonth());
    const today = now.getDate();

    const tracking = {};
    tracking[mk] = {};

    const habit = {
      id: generateId(),
      name: name.trim(),
      createdAt: now.toISOString(),
      tracking: tracking,
      goals: {},
    };
    dream.habits.push(habit);
    saveData(appData);
    return habit;
  }

  function updateHabit(dreamId, habitId, name) {
    const dream = getDream(dreamId);
    if (!dream) return;
    const habit = dream.habits.find(h => h.id === habitId);
    if (habit) {
      habit.name = name.trim();
      saveData(appData);
    }
  }

  function deleteHabit(dreamId, habitId) {
    const dream = getDream(dreamId);
    if (!dream) return;
    dream.habits = dream.habits.filter(h => h.id !== habitId);
    saveData(appData);
  }

  // Toggle between: empty → true (✓) → 'na' (NA) → empty
  function cycleHabitDay(dreamId, habitId, monthKey, day) {
    const dream = getDream(dreamId);
    if (!dream) return;
    const habit = dream.habits.find(h => h.id === habitId);
    if (!habit) return;
    if (!habit.tracking[monthKey]) habit.tracking[monthKey] = {};
    const current = habit.tracking[monthKey][day];
    if (current === true) {
      delete habit.tracking[monthKey][day];
    } else {
      habit.tracking[monthKey][day] = true;
    }
    saveData(appData);
    syncHabitChangeToMyd(dreamId, habitId, monthKey, day, habit.tracking[monthKey][day] === true);
  }

  // Simple toggle for habits where goal = totalDays (no NA needed)
  function toggleHabitDay(dreamId, habitId, monthKey, day) {
    const dream = getDream(dreamId);
    if (!dream) return;
    const habit = dream.habits.find(h => h.id === habitId);
    if (!habit) return;
    if (!habit.tracking[monthKey]) habit.tracking[monthKey] = {};
    habit.tracking[monthKey][day] = !habit.tracking[monthKey][day];
    if (!habit.tracking[monthKey][day]) delete habit.tracking[monthKey][day];
    saveData(appData);
    syncHabitChangeToMyd(dreamId, habitId, monthKey, day, habit.tracking[monthKey][day] === true);
  }

  function syncHabitChangeToMyd(dreamId, habitId, monthKeyVal, day, isCompleted) {
    const todayDate = new Date();
    const todayDay = todayDate.getDate();
    const todayMk = monthKey(todayDate.getFullYear(), todayDate.getMonth());
    
    if (day === todayDay && monthKeyVal === todayMk) {
      let found = false;
      Object.values(mydFlowState.tasks).forEach(task => {
        if (task.habitId === habitId || (task.name === getDream(dreamId)?.habits.find(h => h.id === habitId)?.name && task.dreamTitle === getDream(dreamId)?.title)) {
          found = true;
          const wasCompleted = task.status === 'completed';
          if (isCompleted) {
            task.status = 'completed';
            if (!task.sessions || task.sessions.length === 0) {
              task.sessions = [{ startTime: new Date().toISOString(), endTime: new Date().toISOString() }];
            } else {
              const last = task.sessions[task.sessions.length - 1];
              if (last && !last.endTime) last.endTime = new Date().toISOString();
            }
          } else {
            task.status = 'active';
            if (wasCompleted) {
              const last = task.sessions[task.sessions.length - 1];
              if (last && last.endTime) last.endTime = null;
            }
          }
        }
      });

      if (!found && isCompleted) {
        const dream = getDream(dreamId);
        if (dream) {
          const habit = dream.habits.find(h => h.id === habitId);
          if (habit) {
            const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            mydFlowState.tasks[taskId] = {
              id: taskId,
              name: habit.name,
              dreamTitle: dream.isSystem ? "Custom Tasks" : dream.title,
              dreamId: dreamId,
              habitId: habitId,
              status: 'completed',
              sessions: [{ startTime: new Date().toISOString(), endTime: new Date().toISOString() }],
              addedAt: new Date().toISOString()
            };
            if (!mydFlowState.rootTaskIds) mydFlowState.rootTaskIds = [];
            mydFlowState.rootTaskIds.push(taskId);
          }
        }
      }

      saveMydState();
      if (pages.map && pages.map.classList.contains('active')) {
        renderMydCanvas();
        updateMydStats();
      }
    }
  }

  // ─── Goal Helpers ──────────────────────────────────────────
  function getHabitGoal(habit, mk, totalDays) {
    if (!habit.goals) habit.goals = {};
    return habit.goals[mk] !== undefined ? habit.goals[mk] : totalDays;
  }

  function setHabitGoal(dreamId, habitId, mk, goalValue) {
    const dream = getDream(dreamId);
    if (!dream) return;
    const habit = dream.habits.find(h => h.id === habitId);
    if (!habit) return;
    if (!habit.goals) habit.goals = {};
    habit.goals[mk] = goalValue;
    saveData(appData);
  }

  // ─── Progress Helpers ─────────────────────────────────────
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  function calcDreamProgress(dream, year, month) {
    if (!dream.habits.length) return 0;
    const mk = monthKey(year, month);
    const totalDays = daysInMonth(year, month);
    let totalChecks = 0;
    let totalGoals = 0;

    dream.habits.forEach(h => {
      const tracking = h.tracking[mk] || {};
      const goal = getHabitGoal(h, mk, totalDays);
      totalChecks += Math.min(Object.keys(tracking).length, goal);
      totalGoals += goal;
    });

    return totalGoals > 0 ? Math.round((totalChecks / totalGoals) * 100) : 0;
  }

  function getOverallMonthlyPct(year, month) {
    const days = daysInMonth(year, month);
    const mk = monthKey(year, month);
    let totalChecks = 0;
    let totalGoals = 0;

    appData.dreams.forEach(dream => {
      dream.habits.forEach(h => {
        const tracking = h.tracking[mk] || {};
        totalChecks += Object.values(tracking).filter(v => v === true).length;
        totalGoals += getHabitGoal(h, mk, days);
      });
    });
    return totalGoals > 0 ? Math.round((totalChecks / totalGoals) * 100) : 0;
  }

  function calcDailyProgress(dream, year, month) {
    const totalDays = daysInMonth(year, month);
    const mk = monthKey(year, month);
    const result = [];
    const habitCount = dream.habits.length;

    for (let d = 1; d <= totalDays; d++) {
      let done = 0;
      dream.habits.forEach(h => {
        const goal = getHabitGoal(h, mk, totalDays);
        if (goal === 0) {
          // Goal is 0 → treat as completed
          done++;
        } else {
          const tracking = h.tracking[mk] || {};
          const val = tracking[d];
          if (val === true) done++;
        }
      });
      result.push({
        day: d,
        done,
        total: habitCount,
        pct: habitCount > 0 ? Math.round((done / habitCount) * 100) : 0,
      });
    }
    return result;
  }

  function calcStreaks(dream, year, month) {
    const totalDays = daysInMonth(year, month);
    const mk = monthKey(year, month);
    const daily = calcDailyProgress(dream, year, month);

    // Completed days = days where ALL habits are done (100%)
    let completedDays = daily.filter(d => d.pct === 100).length;

    // Per-habit streak calculation
    let longestStreak = 0;
    let bestHabitName = '';

    dream.habits.forEach(h => {
      const goal = getHabitGoal(h, mk, totalDays);
      if (goal === 0) return; // skip habits with no goal

      const tracking = h.tracking[mk] || {};
      let current = 0;
      let best = 0;

      for (let d = 1; d <= totalDays; d++) {
        const val = tracking[d];
        if (val === true) {
          current++;
          if (current > best) best = current;
        } else {
          current = 0;
        }
      }

      if (best > longestStreak) {
        longestStreak = best;
        bestHabitName = h.name;
      }
    });

    return { longestStreak, completedDays, bestHabitName };
  }

  function calcHabitProgress(habit, year, month) {
    const mk = monthKey(year, month);
    const totalDays = daysInMonth(year, month);
    const tracking = habit.tracking[mk] || {};
    const done = Object.values(tracking).filter(v => v === true).length;
    const naCount = 0;
    const goal = getHabitGoal(habit, mk, totalDays);
    if (goal === 0) return { done: 0, goal: 0, total: totalDays, naCount, pct: 100 };
    return { done, goal, total: totalDays, naCount, pct: Math.round((done / goal) * 100) };
  }

  // ─── Render: Landing Page ──────────────────────────────────
  function renderDreamsGrid() {
    const grid = $('#dreams-grid');
    const empty = $('#empty-dreams');

    if (appData.dreams.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';

    grid.innerHTML = appData.dreams.map(dream => {
      const pct = calcDreamProgress(dream, currentYear, currentMonth);
      return `
        <div class="dream-card" data-id="${dream.id}">
          <div class="dream-card-title">${escapeHtml(dream.title)}</div>
          <div class="dream-card-progress">
            <div class="dream-card-bar">
              <div class="dream-card-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="dream-card-pct">${pct}%</span>
          </div>
          <div class="dream-card-actions">
            <button class="dream-card-btn open" data-action="open" data-id="${dream.id}">Open Plan</button>
            <button class="dream-card-btn edit" data-action="edit" data-id="${dream.id}">Edit</button>
            <button class="dream-card-btn delete" data-action="delete" data-id="${dream.id}">Delete</button>
          </div>
        </div>`;
    }).join('');

    // Card click events
    grid.querySelectorAll('.dream-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        switch (btn.dataset.action) {
          case 'open':
            navigate(`dream/${id}`);
            break;
          case 'edit':
            editingDreamId = id;
            openDreamModal(getDream(id).title);
            break;
          case 'delete':
            deletingType = 'dream';
            deletingId = id;
            $('#confirm-message').textContent = `Delete "${getDream(id).title}"? This cannot be undone.`;
            openModal('modal-confirm');
            break;
        }
      });
    });

    // Click card body → open
    grid.querySelectorAll('.dream-card').forEach(card => {
      card.addEventListener('click', () => {
        navigate(`dream/${card.dataset.id}`);
      });
    });

    // Make cards draggable and add drag-and-drop event handlers for smooth reordering
    grid.querySelectorAll('.dream-card').forEach(card => {
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        
        // Save the new order based on current DOM order
        const currentIds = Array.from(grid.querySelectorAll('.dream-card')).map(c => c.dataset.id);
        const reorderedDreams = currentIds.map(id => appData.dreams.find(d => d.id === id)).filter(Boolean);
        appData.dreams = reorderedDreams;
        saveData(appData);
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingCard = grid.querySelector('.dream-card.dragging');
        if (!draggingCard || draggingCard === card) return;

        // Perform FLIP first frame
        const currentCards = Array.from(grid.querySelectorAll('.dream-card'));
        const firstPositions = currentCards.map(c => ({
          el: c,
          rect: c.getBoundingClientRect()
        }));

        // Determine where to insert the dragging card
        const draggingIndex = currentCards.indexOf(draggingCard);
        const targetIndex = currentCards.indexOf(card);

        if (draggingIndex < targetIndex) {
          card.after(draggingCard);
        } else {
          card.before(draggingCard);
        }

        // Apply FLIP transition
        const newCards = grid.querySelectorAll('.dream-card');
        newCards.forEach(c => {
          const first = firstPositions.find(p => p.el === c);
          if (first) {
            const lastRect = c.getBoundingClientRect();
            const dx = first.rect.left - lastRect.left;
            const dy = first.rect.top - lastRect.top;
            if (dx !== 0 || dy !== 0) {
              c.style.transition = 'none';
              c.style.transform = `translate(${dx}px, ${dy}px)`;
              c.offsetHeight; // force reflow
              c.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)';
              c.style.transform = 'none';
            }
          }
        });
      });
    });
  }

  // ─── Render: Dream Detail Page ─────────────────────────────
  function renderDreamPage() {
    const dream = getDream(currentDreamId);
    if (!dream) {
      navigate('landing');
      return;
    }

    populateDreamSwitcher();
    updateMonthPicker();
    renderHabitGrid(dream);
    updateDreamProgressBar(dream);
  }

  function populateDreamSwitcher() {
    const switcher = $('#dream-switcher');
    switcher.innerHTML = appData.dreams.map(d =>
      `<option value="${d.id}" ${d.id === currentDreamId ? 'selected' : ''}>${escapeHtml(d.title)}</option>`
    ).join('');
  }

  function updateMonthPicker() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Update triggers text
    $('#month-trigger').innerHTML = `${monthNames[currentMonth]} <span class="arrow">▼</span>`;
    $('#year-trigger').innerHTML = `${currentYear} <span class="arrow">▼</span>`;

    // Populate month menu items
    const monthMenu = $('#month-menu');
    monthMenu.innerHTML = monthNames.map((name, idx) => `
      <button class="dropdown-item ${idx === currentMonth ? 'active' : ''}" data-month="${idx}">
        ${name}
      </button>
    `).join('');

    // Populate year menu items: 2000 to 2050
    const yearMenu = $('#year-menu');
    const years = [];
    for (let y = 2000; y <= 2050; y++) {
      years.push(y);
    }
    yearMenu.innerHTML = years.map(y => `
      <button class="dropdown-item ${y === currentYear ? 'active' : ''}" data-year="${y}">
        ${y}
      </button>
    `).join('');

    // Attach click events to the items
    monthMenu.querySelectorAll('.dropdown-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        console.log("Month item clicked:", btn.dataset.month);
        e.stopPropagation();
        currentMonth = parseInt(btn.dataset.month);
        monthMenu.classList.remove('show');
        $('#month-trigger').closest('.custom-dropdown').classList.remove('open');
        renderDreamPage();
      });
    });

    yearMenu.querySelectorAll('.dropdown-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        console.log("Year item clicked:", btn.dataset.year);
        e.stopPropagation();
        currentYear = parseInt(btn.dataset.year);
        yearMenu.classList.remove('show');
        $('#year-trigger').closest('.custom-dropdown').classList.remove('open');
        renderDreamPage();
      });
    });
  }

  function updateDreamProgressBar(dream) {
    const pct = calcDreamProgress(dream, currentYear, currentMonth);
    const fill = $('#dream-progress-fill');
    const text = $('#dream-progress-text');
    if (fill) fill.style.width = Math.max(pct, 5) + '%';
    if (text) text.textContent = pct + '%';
  }

  function renderHabitGrid(dream) {
    const container = $('#habit-grid-container');
    const emptyHabits = $('#empty-habits');

    if (dream.habits.length === 0) {
      container.innerHTML = '';
      emptyHabits.style.display = 'block';
      return;
    }

    emptyHabits.style.display = 'none';
    const days = daysInMonth(currentYear, currentMonth);
    const mk = monthKey(currentYear, currentMonth);

    let html = '<table class="habit-grid"><thead><tr>';
    html += '<th class="habit-name-col">Habit</th>';
    html += '<th class="goal-col">Goal</th>';

    const now = new Date();
    const isThisMonth = (currentYear === now.getFullYear() && currentMonth === now.getMonth());
    const todayNum = now.getDate();

    for (let d = 1; d <= days; d++) {
      const todayClass = (isThisMonth && d === todayNum) ? 'is-today' : '';
      html += `<th class="day-header ${todayClass}">${d}</th>`;
    }
    html += '</tr></thead><tbody>';

    dream.habits.forEach(habit => {
      const tracking = habit.tracking[mk] || {};
      const progress = calcHabitProgress(habit, currentYear, currentMonth);
      const pctClamped = Math.min(progress.pct, 100);
      const barColor = pctClamped === 100 ? 'var(--green)' : 'var(--blue)';

      html += '<tr>';
      html += `<td class="habit-name-cell">
        <div class="habit-name-inner">
          <span style="flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(habit.name)}</span>
          <button class="habit-edit-btn" data-habit-id="${habit.id}" title="Edit habit">✎</button>
          <button class="habit-delete-btn" data-habit-id="${habit.id}" title="Delete habit">✕</button>
        </div>
      </td>`;
      html += `<td class="goal-col"><input type="number" class="goal-input" data-habit="${habit.id}" value="${progress.goal}" min="0" max="${days}" /></td>`;

      for (let d = 1; d <= days; d++) {
        if (progress.goal === 0) {
          // Goal is 0 → show NA
          html += `<td><span class="day-na">NA</span></td>`;
        } else {
          const val = tracking[d];
          let stateClass = 'state-empty';
          let label = '';
          if (val === true) { stateClass = 'state-done'; label = '&#10003;'; }
          html += `<td><button class="day-tri ${stateClass}" data-habit="${habit.id}" data-day="${d}">${label}</button></td>`;
        }
      }

      html += '</tr>';
    });

    // Daily summary row
    html += '<tr class="daily-summary-row">';
    html += '<td class="habit-name-cell" style="background:var(--gradient-soft)!important;font-weight:700;">Daily %</td>';
    html += '<td class="goal-col" style="background:var(--gradient-soft)!important;"></td>';

    const dailyData = calcDailyProgress(dream, currentYear, currentMonth);
    dailyData.forEach(d => {
      const cls = d.pct === 100 ? 'full' : d.pct > 0 ? 'partial' : 'zero';
      html += `<td><span class="daily-pct ${cls}">${d.pct}%</span></td>`;
    });



    html += '</tr></tbody></table>';
    container.innerHTML = html;

    // Tri-state button events (Unified logic for all cells)
    container.querySelectorAll('.day-tri').forEach(btn => {
      btn.addEventListener('click', () => {
        cycleHabitDay(currentDreamId, btn.dataset.habit, mk, parseInt(btn.dataset.day));
        renderHabitGrid(dream);
        renderDailySummary(dream);
        renderMonthlySummary(dream);
        updateDreamProgressBar(dream);
      });
    });

    // Goal input events
    container.querySelectorAll('.goal-input').forEach(input => {
      input.addEventListener('change', () => {
        let val = parseInt(input.value);
        if (isNaN(val) || val < 0) val = 0;
        if (val > days) val = days;
        input.value = val;
        setHabitGoal(currentDreamId, input.dataset.habit, mk, val);
        renderHabitGrid(dream);
        renderDailySummary(dream);
        renderMonthlySummary(dream);
        updateDreamProgressBar(dream);
      });
    });

    // Habit delete
    container.querySelectorAll('.habit-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        deletingType = 'habit';
        deletingId = btn.dataset.habitId;
        const habit = dream.habits.find(h => h.id === btn.dataset.habitId);
        $('#confirm-message').textContent = `Delete habit "${habit ? habit.name : ''}"?`;
        openModal('modal-confirm');
      });
    });

    // Habit edit
    container.querySelectorAll('.habit-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const habitId = btn.dataset.habitId;
        const habit = dream.habits.find(h => h.id === habitId);
        if (habit) {
          editingHabitId = habitId;
          $('#modal-habit h3').textContent = 'Edit Habit';
          $('#input-habit-name').value = habit.name;
          $('#btn-save-habit').textContent = 'Save Changes';
          openModal('modal-habit');
          setTimeout(() => $('#input-habit-name').focus(), 100);
        }
      });
    });
  }

  // ─── Render: Daily Chart ──────────────────────────────────
  function renderDailySummary(dream) {
    const dailyData = calcDailyProgress(dream, currentYear, currentMonth);
    const ctx = $('#daily-chart');

    if (dailyChart) dailyChart.destroy();

    dailyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dailyData.map(d => d.day),
        datasets: [{
          label: 'Daily Completion %',
          data: dailyData.map(d => d.pct),
          borderColor: '#4A7CFF',
          backgroundColor: 'rgba(74,124,255,0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#4A7CFF',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: v => v + '%',
              font: { size: 11, family: 'Inter' },
              color: '#9CA3B4',
            },
            grid: { color: '#F0F2F5' },
          },
          x: {
            ticks: { font: { size: 10, family: 'Inter' }, color: '#9CA3B4' },
            grid: { display: false },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1A1D29',
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: item => `You have completed ${item.parsed.y}% of the daily goal`
            }
          }
        },
      }
    });
  }

  // ─── Render: Monthly Summary ──────────────────────────────
  function renderMonthlySummary(dream) {
    const totalDays = daysInMonth(currentYear, currentMonth);
    const streaks = calcStreaks(dream, currentYear, currentMonth);
    const pct = calcDreamProgress(dream, currentYear, currentMonth);

    // Consistency = percentage of days with ANY completion
    const dailyData = calcDailyProgress(dream, currentYear, currentMonth);
    const activeDays = dailyData.filter(d => d.pct > 0).length;
    const consistency = totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;

    $('#stat-total-days').textContent = totalDays;
    $('#stat-completed-days').textContent = streaks.completedDays;
    $('#stat-completion-pct').textContent = pct + '%';
    $('#stat-longest-streak').textContent = streaks.longestStreak;
    const statStreakHabit = $('#stat-streak-habit');
    if (statStreakHabit) statStreakHabit.textContent = streaks.bestHabitName || '—';
    $('#stat-consistency').textContent = consistency + '%';
  }

  // ─── Render: Dashboard ────────────────────────────────────
  function renderDashboard() {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth();
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const today = now.getDate();

    // Gather data
    let totalChecks = 0;
    let possibleChecks = 0;
    let bestStreak = 0;
    let bestStreakHabit = '';
    const habitStats = [];
    const dreamStats = [];

    appData.dreams.forEach(dream => {
      let dreamDone = 0;
      let dreamTotal = 0;

      dream.habits.forEach(h => {
        const tracking = h.tracking[mk] || {};
        const done = Object.values(tracking).filter(v => v === true).length;
        const goal = getHabitGoal(h, mk, days);
        totalChecks += done;
        possibleChecks += goal;
        dreamDone += done;
        dreamTotal += goal;
        // Calculate per-habit streak
        let currentS = 0, bestS = 0;
        for (let d = 1; d <= days; d++) {
          if (tracking[d] === true) { currentS++; if (currentS > bestS) bestS = currentS; }
          else { currentS = 0; }
        }

        habitStats.push({
          name: h.name,
          dreamTitle: dream.title,
          done,
          total: goal,
          pct: goal > 0 ? Math.round((done / goal) * 100) : 0,
          streak: bestS
        });
      });

      const streaks = calcStreaks(dream, yr, mo);
      if (streaks.longestStreak > bestStreak) {
        bestStreak = streaks.longestStreak;
        bestStreakHabit = streaks.bestHabitName;
      }

      dreamStats.push({
        id: dream.id,
        title: dream.title,
        done: dreamDone,
        total: dreamTotal,
        pct: dreamTotal > 0 ? Math.round((dreamDone / dreamTotal) * 100) : 0,
      });
    });

    const overallPct = possibleChecks > 0 ? Math.round((totalChecks / possibleChecks) * 100) : 0;

    // Today's completion
    let todayDone = 0;
    let todayTotal = 0;
    appData.dreams.forEach(dream => {
      dream.habits.forEach(h => {
        const goal = getHabitGoal(h, mk, days);
        if (goal === 0) return;
        todayTotal++;
        const tracking = h.tracking[mk] || {};
        const val = tracking[today];
        if (val === true) todayDone++;
      });
    });
    const todayPct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0;

    // Focus dream (highest activity)
    const focusDream = dreamStats.reduce((best, d) => (d.done > (best ? best.done : -1)) ? d : best, null);

    // Momentum Score
    const momentum = calcMomentumScore(yr, mo, overallPct, bestStreak);

    // Focus dream contribution %
    const focusContrib = focusDream && totalChecks > 0
      ? Math.round((focusDream.done / totalChecks) * 100) : 0;

    // Performance Rating for Momentum
    const momentumRating = momentum >= 85 ? 'ELITE' :
      momentum >= 70 ? 'GREAT' :
        momentum >= 50 ? 'GOOD' :
          momentum >= 30 ? 'BUILDING' : 'STARTING';

    // Update stat cards
    $('#dash-momentum').textContent = momentum;
    const momSub = $('#dash-momentum-sub') || { textContent: '' };
    momSub.textContent = `${momentumRating} PERFORMANCE`;

    $('#dash-streak').textContent = bestStreak;
    const dashStreakHabit = $('#dash-streak-habit');
    if (dashStreakHabit) dashStreakHabit.textContent = bestStreakHabit || '';
    $('#dash-today').textContent = todayPct + '%';
    $('#dash-focus-dream').textContent = focusDream ? focusDream.title : '—';
    $('#dash-focus-pct').textContent = focusDream ? focusContrib + '% of your energy' : '';

    // Populate Streak Tooltip (Top 3)
    const topStreaks = [...habitStats]
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 3);
    const streakList = $('#dash-streak-list');
    if (streakList) {
      streakList.innerHTML = topStreaks.map(s =>
        `<li><strong>${s.streak} days</strong> in ${escapeHtml(s.name)}</li>`
      ).join('') || '<li>No streaks yet</li>';
    }

    // Populate Focus Tooltip (Top vs Lowest Energy)
    const focusAnalysis = $('#dash-focus-analysis');
    if (focusAnalysis && dreamStats.length > 0) {
      const energySorted = [...dreamStats].sort((a, b) => b.done - a.done);
      const topEnergy = energySorted[0];
      const lowEnergy = energySorted[energySorted.length - 1];

      const topPct = totalChecks > 0 ? Math.round((topEnergy.done / totalChecks) * 100) : 0;
      const lowPct = totalChecks > 0 ? Math.round((lowEnergy.done / totalChecks) * 100) : 0;

      let analysisHtml = `<li><strong>Top Energy:</strong> ${escapeHtml(topEnergy.title)} (${topPct}%)</li>`;
      if (energySorted.length > 1) {
        analysisHtml += `<li><strong>Lowest Energy:</strong> ${escapeHtml(lowEnergy.title)} (${lowPct}%)</li>`;
      }
      focusAnalysis.innerHTML = analysisHtml;
    }

    updateMomentumTips(yr, mo, overallPct, bestStreak, habitStats, todayPct);

    // Render sections
    renderDreamPieChart(dreamStats);
    renderWeeklyTrend(yr, mo);
    renderHeatmap(yr, mo);
    generateSmartInsights(yr, mo, overallPct, bestStreak, bestStreakHabit, dreamStats);
    renderTopHabits(habitStats);
    renderDreamsComparison(yr, mo);
    renderAchievements(overallPct, bestStreak, momentum, todayPct);
    renderPerformanceGraph(yr, mo);
  }

  // ─── Momentum Score ─────────────────────────────────────
  function calcMomentumScore(yr, mo, overallPct, bestStreak) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);

    // Component 1: Completion (40%)
    const completionScore = overallPct * 0.4;

    // Component 2: Streak (25%) - normalized to month length
    const streakScore = Math.min(bestStreak / days, 1) * 100 * 0.25;

    // Component 3: Weekly growth (20%)
    const weeklyPcts = getWeeklyPcts(yr, mo);
    let growth = 0;
    if (weeklyPcts.length >= 2) {
      const last = weeklyPcts[weeklyPcts.length - 1];
      const prev = weeklyPcts[weeklyPcts.length - 2];
      growth = prev > 0 ? ((last - prev) / prev) * 100 : (last > 0 ? 100 : 0);
    }
    const growthScore = Math.min(Math.max(growth + 50, 0), 100) * 0.2;

    // Component 4: Consistency (15%) - days with >50% done
    let consistentDays = 0;
    const today = new Date().getDate();
    const daysToCheck = Math.min(today, days);
    for (let d = 1; d <= daysToCheck; d++) {
      let dayTotal = 0;
      let dayDone = 0;
      appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
          const goal = getHabitGoal(h, mk, days);
          if (goal === 0) return;
          dayTotal++;
          const tracking = h.tracking[mk] || {};
          const val = tracking[d];
          if (val === true) dayDone++;
        });
      });
      if (dayTotal > 0 && (dayDone / dayTotal) >= 0.5) consistentDays++;
    }
    const consistencyScore = (daysToCheck > 0 ? (consistentDays / daysToCheck) : 0) * 100 * 0.15;

    return Math.round(completionScore + streakScore + growthScore + consistencyScore);
  }

  function updateMomentumTips(yr, mo, overallPct, bestStreak, habitStats, todayPct) {
    const tipContainer = $('#dash-momentum-tips ul');
    if (!tipContainer) return;

    const tips = [];

    // 1. Today's Analysis
    if (todayPct >= 100) {
      tips.push('<strong>Today:</strong> 100% completion! Keep this momentum up.');
    } else if (todayPct >= 50) {
      tips.push(`<strong>Today:</strong> ${todayPct}% done. Push a bit more for a perfect score!`);
    } else {
      tips.push(`<strong>Today:</strong> ${todayPct}% is low. Complete more tasks to save your momentum!`);
    }

    // 2. Top & Least Habits
    const sortedHabits = [...habitStats].sort((a, b) => b.pct - a.pct);
    if (sortedHabits.length > 0) {
      const top = sortedHabits[0];
      const least = sortedHabits[sortedHabits.length - 1];

      tips.push(`<strong>Top Habit:</strong> ${escapeHtml(top.name)} at ${top.pct}%`);

      if (least.pct < top.pct) {
        tips.push(`<strong>Focus Needed:</strong> ${escapeHtml(least.name)} at ${least.pct}%`);
      }
    }

    // 3. Weekly Growth
    const weeklyData = getWeeklyPcts(yr, mo);
    if (weeklyData.length >= 2) {
      const last = weeklyData[weeklyData.length - 1].pct;
      const prev = weeklyData[weeklyData.length - 2].pct;
      const growth = last - prev;
      const growthSign = growth >= 0 ? '+' : '';
      tips.push(`<strong>Weekly Growth:</strong> ${growthSign}${growth}% effort vs last week`);
    } else {
      tips.push('<strong>Weekly Growth:</strong> Tracking data... (Week 1)');
    }

    tipContainer.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  }

  // ─── Helper: Get weekly completion %s ───────────────────
  function getWeeklyPcts(yr, mo) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weeks = [];
    let weekStart = 1;

    while (weekStart <= days) {
      const weekEnd = Math.min(weekStart + 6, days);
      let weekDone = 0;
      let weekTotal = 0;

      for (let d = weekStart; d <= weekEnd; d++) {
        appData.dreams.forEach(dream => {
          dream.habits.forEach(h => {
            const goal = getHabitGoal(h, mk, days);
            if (goal === 0) return;
            weekTotal++;
            const tracking = h.tracking[mk] || {};
            if (tracking[d] === true) weekDone++;
          });
        });
      }

      // Label like "Feb 1-7"
      const label = `${monthNames[mo]} ${weekStart}${weekStart === weekEnd ? '' : '-' + weekEnd}`;

      weeks.push({
        pct: weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0,
        label: label
      });
      weekStart = weekEnd + 1;
    }
    return weeks;
  }

  // ─── Dream Pie Chart ────────────────────────────────────
  function renderDreamPieChart(dreamStats) {
    const ctx = $('#dream-pie-chart');
    if (pieChart) pieChart.destroy();

    if (dreamStats.length === 0) {
      ctx.parentElement.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">No dreams yet</p>';
      return;
    }

    const colors = ['#4A7CFF', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#14B8A6'];

    pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: dreamStats.map(d => d.title),
        datasets: [{
          data: dreamStats.map(d => d.done || 1),
          backgroundColor: dreamStats.map((_, i) => colors[i % colors.length]),
          borderWidth: 0,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyleWidth: 10,
              font: { family: 'Inter', size: 11, weight: '500' },
              color: '#6B7280',
            }
          },
          tooltip: {
            backgroundColor: '#1A1D29',
            padding: 12,
            cornerRadius: 8,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
            callbacks: {
              label: item => {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((item.parsed / total) * 100) : 0;
                return ` ${item.label}: ${pct}% contribution`;
              }
            }
          }
        }
      }
    });
  }

  // ─── Weekly Trend Chart ─────────────────────────────────
  function renderWeeklyTrend(yr, mo) {
    const ctx = $('#weekly-trend-chart');
    if (weeklyChart) weeklyChart.destroy();

    const weeklyData = getWeeklyPcts(yr, mo);
    const labels = weeklyData.map(w => w.label);
    const pcts = weeklyData.map(w => w.pct);

    // Gradient for the area fill
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(74, 124, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(74, 124, 255, 0)');

    weeklyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Completion %',
          data: pcts,
          borderColor: '#4A7CFF',
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#4A7CFF',
          pointBorderWidth: 3,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointHoverBackgroundColor: '#4A7CFF',
          pointHoverBorderColor: '#fff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: v => v + '%',
              font: { size: 11, family: 'Inter', weight: '500' },
              color: '#9CA3B4',
              stepSize: 20
            },
            grid: { color: '#F0F2F5', drawBorder: false },
          },
          x: {
            ticks: {
              font: { size: 10, family: 'Inter', weight: '500' },
              color: '#9CA3B4'
            },
            grid: { display: false },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1A1D29',
            padding: 12,
            cornerRadius: 8,
            titleFont: { size: 12, family: 'Inter', weight: '700' },
            bodyFont: { size: 12, family: 'Inter' },
            displayColors: false,
            callbacks: {
              label: item => `You completed ${item.parsed.y}% of this week's goal`
            }
          }
        }
      }
    });
  }

  // ─── Heatmap ────────────────────────────────────────────
  function renderHeatmap(yr, mo) {
    const container = $('#dash-heatmap');
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let html = '<div class="heatmap-label">' + monthNames[mo] + ' ' + yr + '</div>';
    html += '<div class="heatmap-grid">';

    for (let d = 1; d <= days; d++) {
      let dayTotal = 0;
      let dayDone = 0;
      appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
          const goal = getHabitGoal(h, mk, days);
          if (goal === 0) return;
          dayTotal++;
          const tracking = h.tracking[mk] || {};
          const val = tracking[d];
          if (val === true) dayDone++;
        });
      });
      const pct = dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0;
      let level = 'level-0';
      if (pct === 100) level = 'level-4';
      else if (pct >= 75) level = 'level-3';
      else if (pct >= 50) level = 'level-2';
      else if (pct > 0) level = 'level-1';

      html += `<div class="heatmap-cell ${level}" title="Day ${d}: ${pct}%"><span class="heatmap-day">${d}</span></div>`;
    }
    html += '</div>';

    // Legend
    html += '<div class="heatmap-legend">';
    html += '<div class="heatmap-legend-info"><span>Lower consistency</span><span>Higher consistency</span></div>';
    html += '<div class="heatmap-legend-cells">';
    html += '<div class="heatmap-cell-mini level-0" title="0%"></div>';
    html += '<div class="heatmap-cell-mini level-1" title="1-49%"></div>';
    html += '<div class="heatmap-cell-mini level-2" title="50-74%"></div>';
    html += '<div class="heatmap-cell-mini level-3" title="75-99%"></div>';
    html += '<div class="heatmap-cell-mini level-4" title="100%"></div>';
    html += '</div>';
    html += '</div>';

    container.innerHTML = html;
  }

  // ─── Smart Insights ─────────────────────────────────────
  function generateSmartInsights(yr, mo, overallPct, bestStreak, bestStreakHabit, dreamStats) {
    const container = $('#dash-insights');
    const insights = [];
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const today = new Date().getDate();

    // 1. Weekly comparison
    const weeklyPcts = getWeeklyPcts(yr, mo);
    if (weeklyPcts.length >= 2) {
      const last = weeklyPcts[weeklyPcts.length - 1];
      const prev = weeklyPcts[weeklyPcts.length - 2];
      const diff = last - prev;
      if (diff > 0) {
        insights.push({ icon: '\u{1F4C8}', text: `<strong>+${diff}%</strong> improvement compared to last week`, type: 'positive' });
      } else if (diff < 0) {
        insights.push({
          icon: '\u{1F4C9}',
          text: `<strong>${diff}%</strong> drop from last week — Try breaking down <strong>"${escapeHtml(dreamStats[0]?.title || 'tasks')}"</strong> into smaller steps to regain momentum!`,
          type: 'warning'
        });
      } else {
        insights.push({ icon: '\u27A1\uFE0F', text: 'Same performance as last week — time to level up!', type: 'neutral' });
      }
    }

    // 2. Last Month Comparison
    const lastMo = mo === 0 ? 11 : mo - 1;
    const lastYr = mo === 0 ? yr - 1 : yr;
    const lastMonthPct = getOverallMonthlyPct(lastYr, lastMo);
    if (lastMonthPct > 0) {
      const moDiff = overallPct - lastMonthPct;
      const moText = moDiff >= 0
        ? `You're performing <strong>${moDiff}% better</strong> than last month (${lastMonthPct}%)`
        : `Currently <strong>${Math.abs(moDiff)}% behind</strong> last month's pace (${lastMonthPct}%)`;
      insights.push({ icon: '\u{1F4C5}', text: moText, type: moDiff >= 0 ? 'positive' : 'neutral' });
    }

    // 3. Consistency check (weekdays vs weekends)
    let weekdayDone = 0, weekdayTotal = 0;
    let weekendDone = 0, weekendTotal = 0;
    for (let d = 1; d <= Math.min(today, days); d++) {
      const dayOfWeek = new Date(yr, mo, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
          const goal = getHabitGoal(h, mk, days);
          if (goal === 0) return;
          const tracking = h.tracking[mk] || {};
          const val = tracking[d];
          if (isWeekend) { weekendTotal++; if (val === true) weekendDone++; }
          else { weekdayTotal++; if (val === true) weekdayDone++; }
        });
      });
    }
    const weekdayPct = weekdayTotal > 0 ? Math.round((weekdayDone / weekdayTotal) * 100) : 0;
    const weekendPct = weekendTotal > 0 ? Math.round((weekendDone / weekendTotal) * 100) : 0;
    if (weekendTotal > 0 && weekdayPct - weekendPct > 20) {
      insights.push({ icon: '\u26A0\uFE0F', text: `Consistency drops on weekends (<strong>${weekendPct}%</strong> vs <strong>${weekdayPct}%</strong> weekdays)`, type: 'warning' });
    }

    // 4. Strongest dream
    const strongest = dreamStats.reduce((best, d) => (d.pct > (best ? best.pct : -1)) ? d : best, null);
    if (strongest && strongest.pct > 0) {
      insights.push({ icon: '\u2B50', text: `<strong>"${escapeHtml(strongest.title)}"</strong> is your top performer at <strong>${strongest.pct}%</strong>`, type: 'positive' });
    }

    // 5. End-of-month prediction
    const predicted = predictEndOfMonth(yr, mo);
    if (predicted !== null) {
      const predIcon = predicted >= 80 ? '\u{1F680}' : predicted >= 50 ? '\u{1F4CA}' : '\u{1F4AA}';
      insights.push({ icon: predIcon, text: `Predicted end-of-month: <strong>${predicted}%</strong> completion`, type: predicted >= 70 ? 'positive' : 'neutral' });
    }

    // 6. Streak insight
    if (bestStreak >= 1) {
      const streakHabitText = bestStreakHabit ? ` in <strong>"${escapeHtml(bestStreakHabit)}"</strong>` : '';
      if (bestStreak >= 7) {
        insights.push({ icon: '\u{1F525}', text: `Amazing <strong>${bestStreak}-day</strong> streak${streakHabitText}! Keep the fire alive!`, type: 'positive' });
      } else if (bestStreak >= 3) {
        insights.push({ icon: '\u{1F4AB}', text: `<strong>${bestStreak}-day</strong> streak${streakHabitText} building — push for 7!`, type: 'neutral' });
      }
    }

    if (insights.length === 0) {
      insights.push({ icon: '\u{1F4A1}', text: 'Start tracking habits to unlock personalized insights!', type: 'neutral' });
    }

    container.innerHTML = insights.map(i =>
      `<div class="insight-row insight-${i.type}">
        <span class="insight-icon">${i.icon}</span>
        <span class="insight-text">${i.text}</span>
      </div>`
    ).join('');
  }

  // ─── Prediction System ──────────────────────────────────
  function predictEndOfMonth(yr, mo) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const today = Math.min(new Date().getDate(), days);
    if (today < 3) return null; // Not enough data

    let totalDone = 0;
    let totalPossible = 0;

    for (let d = 1; d <= today; d++) {
      appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
          const goal = getHabitGoal(h, mk, days);
          if (goal === 0) return;
          totalPossible++;
          const tracking = h.tracking[mk] || {};
          if (tracking[d] === true) totalDone++;
        });
      });
    }

    if (totalPossible === 0) return null;
    const dailyAvgRate = totalDone / today;
    const habitsPerDay = totalPossible / today;
    const totalGoals = habitsPerDay * days;
    const predictedDone = dailyAvgRate * days;
    return Math.round((predictedDone / totalGoals) * 100);
  }

  // ─── Achievements ───────────────────────────────────────
  function renderAchievements(overallPct, bestStreak, momentum, todayPct) {
    const container = $('#dash-achievements');

    const badges = [
      { id: 'spark', icon: '\u{1F525}', name: 'First Spark', desc: '1-day streak', unlocked: bestStreak >= 1 },
      { id: 'triple', icon: '\u26A1', name: 'Triple Threat', desc: '3-day streak', unlocked: bestStreak >= 3 },
      { id: 'weekly', icon: '\u{1F5D3}\uFE0F', name: 'Week Warrior', desc: '7-day streak', unlocked: bestStreak >= 7 },
      { id: 'unstoppable', icon: '\u{1F4AA}', name: 'Unstoppable', desc: '14-day streak', unlocked: bestStreak >= 14 },
      { id: 'legend', icon: '\u{1F3C6}', name: 'Legend', desc: '30-day streak', unlocked: bestStreak >= 30 },
      { id: 'perfect', icon: '\u{1F4AF}', name: 'Perfectionist', desc: '100% today', unlocked: todayPct === 100 },
      { id: 'halfwayMo', icon: '\u{1F3AF}', name: 'Half Way', desc: '50% monthly', unlocked: overallPct >= 50 },
      { id: 'master', icon: '\u{1F680}', name: 'Momentum Master', desc: 'Score > 80', unlocked: momentum > 80 },
    ];

    container.innerHTML = badges.map(b =>
      `<div class="badge-card ${b.unlocked ? 'badge-unlocked' : 'badge-locked'}">
        <div class="badge-icon">${b.unlocked ? b.icon : '🔒'}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>`
    ).join('');
  }

  // ─── Top 5 Habits (redesigned) ──────────────────────────
  function renderTopHabits(habitStats) {
    const body = $('#top-habits-body');
    const sorted = [...habitStats].sort((a, b) => b.pct - a.pct).slice(0, 5);

    if (sorted.length === 0) {
      body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px;">No habits tracked yet.</p>';
      return;
    }

    body.innerHTML = sorted.map((h, i) => {
      const barColor = h.pct === 100 ? 'var(--green)' : 'var(--blue)';
      const statusLabel = h.pct === 100 ? '<span class="status-badge status-success">PERFECT</span>' :
        h.pct >= 80 ? '<span class="status-badge status-info">ON TRACK</span>' : '';
      return `
        <div class="top-habit-row">
          <span class="top-habit-rank">${i + 1}</span>
          <div class="top-habit-info">
            <div class="top-habit-name-wrapper">
              <div class="top-habit-name">${escapeHtml(h.name)}</div>
              ${statusLabel}
            </div>
            <div class="top-habit-dream">${escapeHtml(h.dreamTitle)}</div>
          </div>
          <div class="top-habit-progress">
            <div class="top-habit-bar">
              <div class="top-habit-bar-fill" style="width:${Math.min(h.pct, 100)}%;background:${barColor}"></div>
            </div>
            <span class="top-habit-pct">${h.pct}%</span>
          </div>
        </div>`;
    }).join('');
  }

  // ─── Dreams Comparison (clickable) ──────────────────────
  function renderDreamsComparison(yr, mo) {
    const container = $('#dreams-comparison');
    if (appData.dreams.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">No dreams added yet.</p>';
      return;
    }

    const sorted = [...appData.dreams]
      .map(dream => ({ dream, pct: calcDreamProgress(dream, yr, mo) }))
      .sort((a, b) => b.pct - a.pct);

    container.innerHTML = sorted.map(({ dream, pct }) => {
      const streaks = calcStreaks(dream, yr, mo);
      return `
        <div class="dream-compare-card" data-id="${dream.id}">
          <div class="dream-compare-left">
            <div class="dream-compare-title">${escapeHtml(dream.title)}</div>
            <span class="dream-compare-meta">${dream.habits.length} habits · ${streaks.longestStreak}🔥 streak</span>
          </div>
          <div class="dream-compare-right">
            <div class="dream-compare-bar">
              <div class="dream-compare-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="dream-compare-pct">${pct}%</span>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.dream-compare-card').forEach(card => {
      card.addEventListener('click', () => navigate(`dream/${card.dataset.id}`));
    });
  }

  // ─── Performance Graph (enhanced) ──────────────────────
  function renderPerformanceGraph(yr, mo) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const labels = [];
    const data = [];

    for (let d = 1; d <= days; d++) {
      labels.push(d);
      let dayTotal = 0;
      let dayDone = 0;
      appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
          const goal = getHabitGoal(h, mk, days);
          if (goal === 0) return;
          dayTotal++;
          const tracking = h.tracking[mk] || {};
          if (tracking[d] === true) dayDone++;
        });
      });
      data.push(dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0);
    }

    const ctx = $('#performance-chart');
    if (perfChart) perfChart.destroy();

    perfChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Daily %',
          data,
          backgroundColor: data.map(v =>
            v === 100 ? 'rgba(34,197,94,0.7)' :
              v > 0 ? 'rgba(74,124,255,0.5)' :
                'rgba(0,0,0,0.05)'
          ),
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: v => v + '%', font: { size: 11, family: 'Inter' }, color: '#9CA3B4' },
            grid: { color: '#F0F2F5' },
          },
          x: {
            ticks: { font: { size: 10, family: 'Inter' }, color: '#9CA3B4' },
            grid: { display: false },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1A1D29',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: item => `You have completed ${item.parsed.y}% of the daily goal`
            }
          }
        }
      }
    });
  }

  // ─── Modals ────────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  function openDreamModal(title) {
    $('#modal-dream-title').textContent = editingDreamId ? 'Edit Dream' : 'Add Dream';
    $('#input-dream-title').value = title || '';
    openModal('modal-dream');
    setTimeout(() => $('#input-dream-title').focus(), 100);
  }

  // ─── Event Bindings ───────────────────────────────────────
  function bindEvents() {
    // Function to trigger Razorpay payment
    function triggerPremiumPayment(callback) {
      const user = JSON.parse(localStorage.getItem('user'));
      if (!user) {
        alert("Please login first.");
        return;
      }

      const options = {
        "key": "rzp_live_SLR8h7buAJQFlF",
        "amount": "19900", // ₹199
        "currency": "INR",
        "name": "Momentum Tutorials",
        "description": "Lifetime Momentum Pass - Unlock Dreams",
        "handler": function (response) {
          console.log("Payment Successful:", response.razorpay_payment_id);
          user.isPremium = true;
          localStorage.setItem('user', JSON.stringify(user));
          alert("Payment Successful! You can now add your dreams.");
          if (callback) callback();
        },
        "prefill": {
          "name": user.name || "",
          "email": user.email || ""
        },
        "theme": { "color": "#4A7CFF" }
      };

      try {
        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error("Razorpay error:", err);
        alert("Could not open payment gateway. Please check your connection.");
      }
    }

    // Hero buttons (Dream addition gated by premium)
    $('#btn-add-dream').addEventListener('click', () => {
      const user = JSON.parse(localStorage.getItem('user'));
      const dreamCount = appData.dreams.length;

      // Allow adding a dream if:
      // 1. User is premium
      // 2. User has fewer than 2 dreams (1 default + 1 new)
      if ((user && user.isPremium) || dreamCount < 2) {
        editingDreamId = null;
        openDreamModal();
      } else {
        window.location.href = 'checkout.html';
      }
    });

    $('#btn-add-dream-empty').addEventListener('click', () => {
      const user = JSON.parse(localStorage.getItem('user'));
      const dreamCount = appData.dreams.length;

      if ((user && user.isPremium) || dreamCount < 2) {
        editingDreamId = null;
        openDreamModal();
      } else {
        window.location.href = 'checkout.html';
      }
    });

    // Dream modal
    $('#btn-save-dream').addEventListener('click', saveDream);
    $('#btn-cancel-dream').addEventListener('click', () => closeModal('modal-dream'));
    $('#modal-dream-close').addEventListener('click', () => closeModal('modal-dream'));
    $('#input-dream-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveDream(); });

    // Habit modal
    $('#btn-add-habit').addEventListener('click', () => {
      editingHabitId = null;
      $('#modal-habit h3').textContent = 'Add Habit';
      $('#btn-save-habit').textContent = 'Add Habit';
      $('#input-habit-name').value = '';
      openModal('modal-habit');
      setTimeout(() => $('#input-habit-name').focus(), 100);
    });
    $('#btn-save-habit').addEventListener('click', saveHabit);
    $('#btn-cancel-habit').addEventListener('click', () => closeModal('modal-habit'));
    $('#modal-habit-close').addEventListener('click', () => closeModal('modal-habit'));
    $('#input-habit-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveHabit(); });

    // Confirm modal
    $('#btn-confirm-ok').addEventListener('click', confirmDelete);
    $('#btn-confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
    $('#modal-confirm-close').addEventListener('click', () => closeModal('modal-confirm'));

    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    // Back button
    $('#btn-back-arrow').addEventListener('click', () => navigate('landing'));

    // Dream switcher
    $('#dream-switcher').addEventListener('change', (e) => {
      navigate(`dream/${e.target.value}`);
    });

    // Setup custom dropdown triggers
    const monthTrigger = $('#month-trigger');
    const monthMenu = $('#month-menu');
    const yearTrigger = $('#year-trigger');
    const yearMenu = $('#year-menu');

    monthTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = monthTrigger.closest('.custom-dropdown');
      parent.classList.toggle('open');
      monthMenu.classList.toggle('show');
      
      const yearParent = yearTrigger.closest('.custom-dropdown');
      yearParent.classList.remove('open');
      yearMenu.classList.remove('show');
    });

    yearTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = yearTrigger.closest('.custom-dropdown');
      parent.classList.toggle('open');
      yearMenu.classList.toggle('show');
      
      const monthParent = monthTrigger.closest('.custom-dropdown');
      monthParent.classList.remove('open');
      monthMenu.classList.remove('show');
      
      if (yearMenu.classList.contains('show')) {
        const active = yearMenu.querySelector('.dropdown-item.active');
        if (active) {
          active.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }
    });

    // Close on outside click
    document.addEventListener('click', () => {
      monthTrigger.closest('.custom-dropdown').classList.remove('open');
      monthMenu.classList.remove('show');
      yearTrigger.closest('.custom-dropdown').classList.remove('open');
      yearMenu.classList.remove('show');
    });

    // Map Your Day is initialized dynamically via renderMapPage
  }

  function saveDream() {
    const title = $('#input-dream-title').value.trim();
    if (!title) return;

    if (editingDreamId) {
      updateDream(editingDreamId, title);
      editingDreamId = null;
    } else {
      addDream(title);
    }

    closeModal('modal-dream');
    renderDreamsGrid();
  }

  function saveHabit() {
    const name = $('#input-habit-name').value.trim();
    if (!name || !currentDreamId) return;

    if (editingHabitId) {
      updateHabit(currentDreamId, editingHabitId, name);
      editingHabitId = null;
    } else {
      addHabit(currentDreamId, name);
    }
    closeModal('modal-habit');
    renderDreamPage();
  }

  function confirmDelete() {
    if (deletingType === 'dream' && deletingId) {
      deleteDream(deletingId);
      closeModal('modal-confirm');
      renderDreamsGrid();
    } else if (deletingType === 'habit' && deletingId && currentDreamId) {
      deleteHabit(currentDreamId, deletingId);
      closeModal('modal-confirm');
      renderDreamPage();
    }
    deletingType = null;
    deletingId = null;
  }

  // ─── Utility ──────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Seed example data if first visit ─────────────────────
  function seedIfEmpty() {
    if (appData.dreams.length > 0) return;

    const dreams = [
      { title: 'Get Fit before 2026', habits: ['Morning Yoga', 'Hydration (8 Cups)', '10,000 Steps', 'No Late Snacks'] },
    ];

    dreams.forEach(d => {
      const dream = addDream(d.title);
      d.habits.forEach(h => addHabit(dream.id, h));
    });
  }

  // Refetch data from Supabase (e.g. when returning to the tab)
  async function refetchData() {
    console.log("Sync check: checking for remote updates...");
    const remoteData = await loadData();
    if (JSON.stringify(remoteData.dreams) !== JSON.stringify(appData.dreams)) {
      console.log("Remote changes detected during sync check, updating UI.");
      appData.dreams = remoteData.dreams;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      handleRoute();
    }
  }

  // Handle Visibility and Focus (especially for Mobile browsers)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refetchData();
  });
  window.addEventListener('focus', refetchData);

  // ─── Init ─────────────────────────────────────────────────
  async function init() {
    appData = await loadData();
    seedIfEmpty();
    bindEvents();
    handleRoute();
    setupSupabaseRealtime();

    // Initial sync check shortly after load
    setTimeout(refetchData, 2000);
  }

  document.addEventListener('DOMContentLoaded', init);

})();

