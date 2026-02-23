/* ===================================
   MOMENTUM – Application Logic
   =================================== */

(function () {
  'use strict';

  // ─── Data Layer ────────────────────────────────────────────
  const STORAGE_KEY = 'momentum_data';

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { dreams: [] };
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let appData = loadData();

  // ─── State ─────────────────────────────────────────────────
  let currentDreamId = null;
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth(); // 0-indexed
  let editingDreamId = null;
  let deletingType = null;  // 'dream' | 'habit'
  let deletingId = null;
  let dailyChart = null;
  let perfChart = null;
  let pieChart = null;
  let weeklyChart = null;

  // ─── DOM Refs ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pages = {
    landing: $('#page-landing'),
    dream: $('#page-dream'),
    dashboard: $('#page-dashboard'),
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
      case 'dashboard':
        pages.dashboard.classList.add('active');
        renderDashboard();
        break;
      default:
        pages.landing.classList.add('active');
        renderDreamsGrid();
        break;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('hashchange', handleRoute);

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
    const habit = {
      id: generateId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      tracking: {},
      goals: {},
    };
    dream.habits.push(habit);
    saveData(appData);
    return habit;
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
    if (!current) {
      habit.tracking[monthKey][day] = true;       // empty → ✓
    } else if (current === true) {
      habit.tracking[monthKey][day] = 'na';       // ✓ → NA
    } else {
      delete habit.tracking[monthKey][day];        // NA → empty
    }
    saveData(appData);
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
          // true (✓) or 'na' both count as "done" for daily %
          if (val === true || val === 'na') done++;
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
        } else if (val === 'na') {
          // NA doesn't break streak, but doesn't extend it
          continue;
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
    // Only count days marked true (✓), not 'na'
    const done = Object.values(tracking).filter(v => v === true).length;
    const naCount = Object.values(tracking).filter(v => v === 'na').length;
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
    renderDailySummary(dream);
    renderMonthlySummary(dream);
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
    $('#year-label').textContent = currentYear;
    $('#current-month-name').textContent = `${monthNames[currentMonth]} ${currentYear}`;
    $('#exec-month-label').textContent = `– ${monthNames[currentMonth]} ${currentYear}`;
    $$('.month-btn').forEach(btn => {
      const m = parseInt(btn.dataset.month);
      btn.classList.toggle('active', m === currentMonth);
    });
  }

  function updateDreamProgressBar(dream) {
    const pct = calcDreamProgress(dream, currentYear, currentMonth);
    const fill = $('#dream-progress-fill');
    const text = $('#dream-progress-text');
    fill.style.width = Math.max(pct, 5) + '%';
    text.textContent = pct + '%';
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

    for (let d = 1; d <= days; d++) {
      html += `<th class="day-header">${d}</th>`;
    }
    html += '<th class="progress-col">Done</th>';
    html += '<th class="progress-end-col">Progress</th>';
    html += '</tr></thead><tbody>';

    dream.habits.forEach(habit => {
      const tracking = habit.tracking[mk] || {};
      const progress = calcHabitProgress(habit, currentYear, currentMonth);
      const pctClamped = Math.min(progress.pct, 100);
      const barColor = pctClamped === 100 ? 'var(--green)' : 'var(--blue)';

      html += '<tr>';
      html += `<td class="habit-name-cell">
        <div class="habit-name-inner">
          <span>${escapeHtml(habit.name)}</span>
          <button class="habit-delete-btn" data-habit-id="${habit.id}" title="Delete habit">✕</button>
        </div>
      </td>`;
      html += `<td class="goal-col"><input type="number" class="goal-input" data-habit="${habit.id}" value="${progress.goal}" min="0" max="${days}" /></td>`;

      const needsTriState = progress.goal > 0 && progress.goal < days;

      for (let d = 1; d <= days; d++) {
        if (progress.goal === 0) {
          // Goal is 0 → show NA
          html += `<td><span class="day-na">NA</span></td>`;
        } else if (needsTriState) {
          // Tri-state: ✓ / ✗ / NA
          const val = tracking[d];
          let stateClass = 'state-empty';
          let label = '';
          if (val === true) { stateClass = 'state-done'; label = '✓'; }
          else if (val === 'na') { stateClass = 'state-na'; label = 'NA'; }
          html += `<td><button class="day-tri ${stateClass}" data-habit="${habit.id}" data-day="${d}">${label}</button></td>`;
        } else {
          // Regular checkbox (goal = total days)
          const checked = tracking[d] ? 'checked' : '';
          html += `<td><input type="checkbox" class="day-checkbox" data-habit="${habit.id}" data-day="${d}" ${checked} /></td>`;
        }
      }

      if (progress.goal === 0) {
        html += `<td class="progress-col">0</td>`;
        html += `<td class="progress-end-col">
          <span class="habit-progress-text" style="color:var(--text-muted);"><b>N/A</b></span>
        </td>`;
      } else {
        html += `<td class="progress-col">${progress.done}</td>`;
        html += `<td class="progress-end-col">
          <div class="habit-progress-visual">
            <div class="habit-progress-bar-bg"><div class="habit-progress-bar-fg" style="width:${pctClamped}%;background:${barColor}"></div></div>
            <span class="habit-progress-text">${progress.done}/${progress.goal} <b>${progress.pct}%</b></span>
          </div>
        </td>`;
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

    // Summary totals
    const totalDone = dailyData.reduce((s, d) => s + d.done, 0);
    let totalGoals = 0;
    dream.habits.forEach(h => { totalGoals += getHabitGoal(h, mk, days); });
    const totalPct = totalGoals > 0 ? Math.round((totalDone / totalGoals) * 100) : 0;
    html += `<td class="progress-col">${totalDone}</td>`;
    html += `<td class="progress-end-col"><span class="habit-progress-text"><b>${totalDone}/${totalGoals} · ${totalPct}%</b></span></td>`;

    html += '</tr></tbody></table>';
    container.innerHTML = html;

    // Regular checkbox events (goal = total days)
    container.querySelectorAll('.day-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        toggleHabitDay(currentDreamId, cb.dataset.habit, mk, parseInt(cb.dataset.day));
        renderHabitGrid(dream);
        renderDailySummary(dream);
        renderMonthlySummary(dream);
        updateDreamProgressBar(dream);
      });
    });

    // Tri-state button events (goal < total days)
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
    $('#stat-streak-habit').textContent = streaks.bestHabitName || '—';
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
          else if (tracking[d] !== 'na') { currentS = 0; }
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
        if (val === true || val === 'na') todayDone++;
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
    $('#dash-streak-habit').textContent = bestStreakHabit || '';
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
          if (val === true || val === 'na') dayDone++;
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
          if (val === true || val === 'na') dayDone++;
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
        insights.push({ icon: '📈', text: `<strong>+${diff}%</strong> improvement compared to last week`, type: 'positive' });
      } else if (diff < 0) {
        insights.push({
          icon: '📉',
          text: `<strong>${diff}%</strong> drop from last week — Try breaking down <strong>"${escapeHtml(dreamStats[0]?.title || 'tasks')}"</strong> into smaller steps to regain momentum!`,
          type: 'warning'
        });
      } else {
        insights.push({ icon: '➡️', text: 'Same performance as last week — time to level up!', type: 'neutral' });
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
      insights.push({ icon: '📅', text: moText, type: moDiff >= 0 ? 'positive' : 'neutral' });
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
      insights.push({ icon: '⚠️', text: `Consistency drops on weekends (<strong>${weekendPct}%</strong> vs <strong>${weekdayPct}%</strong> weekdays)`, type: 'warning' });
    }

    // 4. Strongest dream
    const strongest = dreamStats.reduce((best, d) => (d.pct > (best ? best.pct : -1)) ? d : best, null);
    if (strongest && strongest.pct > 0) {
      insights.push({ icon: '⭐', text: `<strong>"${escapeHtml(strongest.title)}"</strong> is your top performer at <strong>${strongest.pct}%</strong>`, type: 'positive' });
    }

    // 5. End-of-month prediction
    const predicted = predictEndOfMonth(yr, mo);
    if (predicted !== null) {
      const predIcon = predicted >= 80 ? '🚀' : predicted >= 50 ? '📊' : '💪';
      insights.push({ icon: predIcon, text: `Predicted end-of-month: <strong>${predicted}%</strong> completion`, type: predicted >= 70 ? 'positive' : 'neutral' });
    }

    // 6. Streak insight
    if (bestStreak >= 1) {
      const streakHabitText = bestStreakHabit ? ` in <strong>"${escapeHtml(bestStreakHabit)}"</strong>` : '';
      if (bestStreak >= 7) {
        insights.push({ icon: '🔥', text: `Amazing <strong>${bestStreak}-day</strong> streak${streakHabitText}! Keep the fire alive!`, type: 'positive' });
      } else if (bestStreak >= 3) {
        insights.push({ icon: '💫', text: `<strong>${bestStreak}-day</strong> streak${streakHabitText} building — push for 7!`, type: 'neutral' });
      }
    }

    if (insights.length === 0) {
      insights.push({ icon: '💡', text: 'Start tracking habits to unlock personalized insights!', type: 'neutral' });
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
      { id: 'spark', icon: '🔥', name: 'First Spark', desc: '1-day streak', unlocked: bestStreak >= 1 },
      { id: 'triple', icon: '⚡', name: 'Triple Threat', desc: '3-day streak', unlocked: bestStreak >= 3 },
      { id: 'weekly', icon: '🗓️', name: 'Week Warrior', desc: '7-day streak', unlocked: bestStreak >= 7 },
      { id: 'unstoppable', icon: '💪', name: 'Unstoppable', desc: '14-day streak', unlocked: bestStreak >= 14 },
      { id: 'legend', icon: '🏆', name: 'Legend', desc: '30-day streak', unlocked: bestStreak >= 30 },
      { id: 'perfect', icon: '💯', name: 'Perfectionist', desc: '100% today', unlocked: todayPct === 100 },
      { id: 'halfwayMo', icon: '🎯', name: 'Half Way', desc: '50% monthly', unlocked: overallPct >= 50 },
      { id: 'master', icon: '🚀', name: 'Momentum Master', desc: 'Score > 80', unlocked: momentum > 80 },
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
    // Hero buttons
    $('#btn-start-journey').addEventListener('click', () => {
      document.getElementById('section-dreams').scrollIntoView({ behavior: 'smooth' });
    });
    $('#btn-add-dream-hero').addEventListener('click', () => {
      editingDreamId = null;
      openDreamModal();
    });
    $('#btn-add-dream').addEventListener('click', () => {
      editingDreamId = null;
      openDreamModal();
    });
    $('#btn-add-dream-empty').addEventListener('click', () => {
      editingDreamId = null;
      openDreamModal();
    });

    // Dream modal
    $('#btn-save-dream').addEventListener('click', saveDream);
    $('#btn-cancel-dream').addEventListener('click', () => closeModal('modal-dream'));
    $('#modal-dream-close').addEventListener('click', () => closeModal('modal-dream'));
    $('#input-dream-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveDream(); });

    // Habit modal
    $('#btn-add-habit').addEventListener('click', () => {
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
    $('#btn-back-landing').addEventListener('click', () => navigate('landing'));

    // Dream switcher
    $('#dream-switcher').addEventListener('change', (e) => {
      navigate(`dream/${e.target.value}`);
    });

    // Year navigation
    $('#btn-prev-year').addEventListener('click', () => {
      currentYear--;
      renderDreamPage();
    });
    $('#btn-next-year').addEventListener('click', () => {
      currentYear++;
      renderDreamPage();
    });

    // Month grid
    $$('.month-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMonth = parseInt(btn.dataset.month);
        renderDreamPage();
      });
    });
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

    addHabit(currentDreamId, name);
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
      { title: 'Run 42.195 KM', habits: ['Morning Run', 'Stretching', 'Diet Plan', 'Sleep 8 Hours'] },
      { title: 'Clear CDS Examination', habits: ['English', 'Mathematics', 'General Studies', 'SSB Preparation'] },
      { title: 'Build 15+ Startups', habits: ['Ideation', 'Coding', 'Marketing', 'Networking'] },
    ];

    dreams.forEach(d => {
      const dream = addDream(d.title);
      d.habits.forEach(h => addHabit(dream.id, h));
    });
  }

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    seedIfEmpty();
    bindEvents();
    handleRoute();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
