// ─── Core data & calculation helpers (ported from app.js) ───────────────────

export const STORAGE_KEY = 'momentum_data';

export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

export function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function getHabitGoal(habit, mk, totalDays) {
    if (!habit.goals) habit.goals = {};
    return habit.goals[mk] !== undefined ? habit.goals[mk] : totalDays;
}

export function calcDreamProgress(dream, year, month) {
    if (!dream.habits.length) return 0;
    const mk = monthKey(year, month);
    const totalDays = daysInMonth(year, month);
    let totalChecks = 0, totalGoals = 0;
    dream.habits.forEach(h => {
        const tracking = h.tracking[mk] || {};
        const goal = getHabitGoal(h, mk, totalDays);
        totalChecks += Math.min(Object.keys(tracking).length, goal);
        totalGoals += goal;
    });
    return totalGoals > 0 ? Math.round((totalChecks / totalGoals) * 100) : 0;
}

export function calcDailyProgress(dream, year, month) {
    const totalDays = daysInMonth(year, month);
    const mk = monthKey(year, month);
    const habitCount = dream.habits.length;
    const result = [];
    for (let d = 1; d <= totalDays; d++) {
        let done = 0;
        dream.habits.forEach(h => {
            const goal = getHabitGoal(h, mk, totalDays);
            if (goal === 0) { done++; return; }
            const val = (h.tracking[mk] || {})[d];
            if (val === true || val === 'na') done++;
        });
        result.push({ day: d, done, total: habitCount, pct: habitCount > 0 ? Math.round((done / habitCount) * 100) : 0 });
    }
    return result;
}

export function calcStreaks(dream, year, month) {
    const totalDays = daysInMonth(year, month);
    const mk = monthKey(year, month);
    const daily = calcDailyProgress(dream, year, month);
    const completedDays = daily.filter(d => d.pct === 100).length;
    let longestStreak = 0, bestHabitName = '';
    dream.habits.forEach(h => {
        const goal = getHabitGoal(h, mk, totalDays);
        if (goal === 0) return;
        const tracking = h.tracking[mk] || {};
        let current = 0, best = 0;
        for (let d = 1; d <= totalDays; d++) {
            const val = tracking[d];
            if (val === true) { current++; if (current > best) best = current; }
            else if (val !== 'na') { current = 0; }
        }
        if (best > longestStreak) { longestStreak = best; bestHabitName = h.name; }
    });
    return { longestStreak, completedDays, bestHabitName };
}

export function calcHabitProgress(habit, year, month) {
    const mk = monthKey(year, month);
    const totalDays = daysInMonth(year, month);
    const tracking = habit.tracking[mk] || {};
    const done = Object.values(tracking).filter(v => v === true).length;
    const naCount = Object.values(tracking).filter(v => v === 'na').length;
    const goal = getHabitGoal(habit, mk, totalDays);
    if (goal === 0) return { done: 0, goal: 0, total: totalDays, naCount, pct: 100 };
    return { done, goal, total: totalDays, naCount, pct: Math.round((done / goal) * 100) };
}

export function getWeeklyPcts(appData, yr, mo) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weeks = [];
    let weekStart = 1;
    while (weekStart <= days) {
        const weekEnd = Math.min(weekStart + 6, days);
        let weekDone = 0, weekTotal = 0;
        for (let d = weekStart; d <= weekEnd; d++) {
            appData.dreams.forEach(dream => {
                dream.habits.forEach(h => {
                    const goal = getHabitGoal(h, mk, days);
                    if (goal === 0) return;
                    weekTotal++;
                    if ((h.tracking[mk] || {})[d] === true) weekDone++;
                });
            });
        }
        const label = `${monthNames[mo]} ${weekStart}${weekStart === weekEnd ? '' : '-' + weekEnd}`;
        weeks.push({ pct: weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0, label });
        weekStart = weekEnd + 1;
    }
    return weeks;
}

export function getOverallMonthlyPct(appData, year, month) {
    const days = daysInMonth(year, month);
    const mk = monthKey(year, month);
    let totalChecks = 0, totalGoals = 0;
    appData.dreams.forEach(dream => {
        dream.habits.forEach(h => {
            const tracking = h.tracking[mk] || {};
            totalChecks += Object.values(tracking).filter(v => v === true).length;
            totalGoals += getHabitGoal(h, mk, days);
        });
    });
    return totalGoals > 0 ? Math.round((totalChecks / totalGoals) * 100) : 0;
}

export function calcMomentumScore(appData, yr, mo, overallPct, bestStreak) {
    const days = daysInMonth(yr, mo);
    const mk = monthKey(yr, mo);
    const completionScore = overallPct * 0.4;
    const streakScore = Math.min(bestStreak / days, 1) * 100 * 0.25;
    const weeklyPcts = getWeeklyPcts(appData, yr, mo);
    let growth = 0;
    if (weeklyPcts.length >= 2) {
        const last = weeklyPcts[weeklyPcts.length - 1].pct;
        const prev = weeklyPcts[weeklyPcts.length - 2].pct;
        growth = prev > 0 ? ((last - prev) / prev) * 100 : (last > 0 ? 100 : 0);
    }
    const growthScore = Math.min(Math.max(growth + 50, 0), 100) * 0.2;
    let consistentDays = 0;
    const today = new Date().getDate();
    const daysToCheck = Math.min(today, days);
    for (let d = 1; d <= daysToCheck; d++) {
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
        if (dayTotal > 0 && (dayDone / dayTotal) >= 0.5) consistentDays++;
    }
    const consistencyScore = (daysToCheck > 0 ? (consistentDays / daysToCheck) : 0) * 100 * 0.15;
    return Math.round(completionScore + streakScore + growthScore + consistencyScore);
}

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Data Layer ──────────────────────────────────────────
export async function loadData(supabase) {
    if (typeof window === 'undefined') return { dreams: [] };
    const user = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
    if (supabase && user && user.isLoggedIn) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                const { data } = await supabase.from('user_data').select('dreams').eq('id', session.user.id).single();
                if (data && data.dreams) return { dreams: data.dreams };
            }
        } catch (e) { console.error('Supabase load error:', e); }
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { dreams: [] };
}

export async function saveData(data, supabase) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    const user = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
    if (supabase && user && user.isLoggedIn) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                await supabase.from('user_data').upsert({ id: session.user.id, dreams: data.dreams, updated_at: new Date().toISOString() });
            }
        } catch (e) { console.error('Supabase sync error:', e); }
    }
}

export function seedIfEmpty(appData) {
    if (appData.dreams.length > 0) return appData;
    const seedDreams = [
        { title: 'Run 42.195 KM', habits: ['Morning Run', 'Stretching', 'Diet Plan', 'Sleep 8 Hours'] },
        { title: 'Clear CDS Examination', habits: ['English', 'Mathematics', 'General Studies', 'SSB Preparation'] },
        { title: 'Build 15+ Startups', habits: ['Ideation', 'Coding', 'Marketing', 'Networking'] },
    ];
    const newData = { dreams: [] };
    seedDreams.forEach(d => {
        const dream = { id: generateId(), title: d.title, createdAt: new Date().toISOString(), habits: [] };
        d.habits.forEach(h => {
            dream.habits.push({ id: generateId(), name: h, createdAt: new Date().toISOString(), tracking: {}, goals: {} });
        });
        newData.dreams.push(dream);
    });
    return newData;
}
