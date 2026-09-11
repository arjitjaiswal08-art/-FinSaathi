/**
 * FinSaathi — AI Financial Planning Engine
 * Handles: data collection, analysis, scoring, chart rendering, insights
 */

'use strict';

/* ===================================================
   CONSTANTS & CONFIG
   =================================================== */
const RUPEE = '₹';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// 50-30-20 thresholds (as % of income)
const BUDGET_NEEDS_IDEAL  = 50;
const BUDGET_WANTS_IDEAL  = 30;
const BUDGET_SAVINGS_IDEAL = 20;

// Chart colours
const CHART_PALETTE = [
  '#00dca8','#a855f7','#3b82f6','#f59e0b',
  '#ef4444','#06b6d4','#22c55e','#f97316','#ec4899'
];

// Needs categories (essential)
const NEEDS_KEYS  = ['rent','food','transport','utilities','healthcare','education','emi'];
// Wants categories (discretionary)
const WANTS_KEYS  = ['entertainment','shopping'];

/* ===================================================
   STATE
   =================================================== */
let charts = {};   // stored Chart.js instances

/* ===================================================
   HELPERS
   =================================================== */
const $ = id => document.getElementById(id);
const fmt = n => `${RUPEE}${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n, d) => d === 0 ? 0 : Math.round((n / d) * 100);

function animateNumber(el, target, duration = 1200, prefix = '') {
  const start = performance.now();
  const from = parseFloat(el.textContent.replace(/[^\d.]/g, '')) || 0;
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(from + (target - from) * ease).toLocaleString('en-IN');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ===================================================
   DATA EXTRACTION
   =================================================== */
function extractFormData() {
  const g = id => parseFloat($(id)?.value) || 0;
  const s = id => $(id)?.value?.trim() || '';

  const income   = g('monthly-income') + g('other-income');
  const expenses = {
    rent:          g('exp-rent'),
    food:          g('exp-food'),
    transport:     g('exp-transport'),
    utilities:     g('exp-utilities'),
    healthcare:    g('exp-healthcare'),
    education:     g('exp-education'),
    emi:           g('exp-emi'),
    entertainment: g('exp-entertainment'),
    shopping:      g('exp-shopping'),
  };
  const savings    = g('current-savings');
  const sip        = g('monthly-sip');
  const totalDebt  = g('total-debt');
  const debtEmi    = g('debt-emi');

  const goals = [];
  for (let i = 1; i <= 2; i++) {
    const name   = s(`goal-name-${i}`);
    const target = g(`goal-target-${i}`);
    const saved  = g(`goal-saved-${i}`);
    if (name && target > 0) goals.push({ name, target, saved });
  }

  return { income, expenses, savings, sip, totalDebt, debtEmi, goals };
}

/* ===================================================
   ANALYSIS ENGINE
   =================================================== */
function analyse(data) {
  const { income, expenses, savings, sip, totalDebt, debtEmi, goals } = data;

  const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0);
  const needs  = NEEDS_KEYS.reduce((a, k) => a + (expenses[k] || 0), 0);
  const wants  = WANTS_KEYS.reduce((a, k) => a + (expenses[k] || 0), 0);

  const monthlySavings = Math.max(0, income - totalExpenses);
  const savingsRate    = pct(monthlySavings, income);
  const debtToIncome   = income > 0 ? (debtEmi / income) * 100 : 0;
  const emergencyMonths = income > 0 ? (savings / income) : 0;

  // Ideal budget
  const idealNeeds   = income * 0.50;
  const idealWants   = income * 0.30;
  const idealSavings = income * 0.20;

  // Recommended SIP: 15% of income if affordable
  const recommendedSip = Math.max(0, Math.round(income * 0.15));
  const sipAffordable  = recommendedSip <= monthlySavings;

  // -------- Health Score --------
  let score = 100;

  // Savings rate (max 35 pts)
  if (savingsRate < 5)       score -= 35;
  else if (savingsRate < 10) score -= 25;
  else if (savingsRate < 15) score -= 15;
  else if (savingsRate < 20) score -= 5;

  // Expense control (max 25 pts)
  const needsPct = pct(needs, income);
  if (needsPct > 70)       score -= 25;
  else if (needsPct > 60)  score -= 15;
  else if (needsPct > 50)  score -= 5;

  // Debt-to-income (max 25 pts)
  if (debtToIncome > 50)      score -= 25;
  else if (debtToIncome > 35) score -= 15;
  else if (debtToIncome > 20) score -= 10;
  else if (debtToIncome > 10) score -= 3;

  // Emergency fund (max 15 pts)
  if (emergencyMonths < 1)  score -= 15;
  else if (emergencyMonths < 3) score -= 10;
  else if (emergencyMonths < 6) score -= 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Grade
  const { grade, gradeColor, gradeDesc } = getGrade(score);

  // Overspending categories
  const overSpend = [];
  const expLabels = {
    rent: 'Rent/EMI', food: 'Food & Groceries', transport: 'Transport',
    utilities: 'Utilities', healthcare: 'Healthcare', education: 'Education',
    emi: 'Other Loans', entertainment: 'Entertainment', shopping: 'Shopping'
  };
  if (expenses.rent      > income * 0.30) overSpend.push(`Rent/EMI (${pct(expenses.rent, income)}% of income — ideal ≤30%)`);
  if (expenses.food      > income * 0.15) overSpend.push(`Food & Groceries (${pct(expenses.food, income)}% — ideal ≤15%)`);
  if (expenses.entertainment > income * 0.08) overSpend.push(`Entertainment (${pct(expenses.entertainment, income)}% — ideal ≤8%)`);
  if (expenses.shopping  > income * 0.06) overSpend.push(`Shopping (${pct(expenses.shopping, income)}% — ideal ≤6%)`);

  // Savings projection (5 yrs at 8% SIP return)
  const sipAmount   = sip > 0 ? sip : Math.min(recommendedSip, monthlySavings);
  const projection  = buildProjection(savings, sipAmount, 12, 0.08);

  // Predict EOMonth balance
  const predictedBalance = income - totalExpenses;

  // Advice
  const advice = buildAdvice({ savingsRate, debtToIncome, emergencyMonths, needsPct, monthlySavings, recommendedSip, sip, sipAffordable, income, totalExpenses, overSpend });

  return {
    income, expenses, savings, sip, totalDebt, debtEmi, goals,
    totalExpenses, needs, wants, monthlySavings, savingsRate,
    debtToIncome, emergencyMonths, idealNeeds, idealWants, idealSavings,
    recommendedSip, sipAffordable, sipAmount, projection,
    score, grade, gradeColor, gradeDesc,
    overSpend, expLabels, advice, predictedBalance
  };
}

function getGrade(score) {
  if (score >= 85) return { grade: '🌟 Excellent',  gradeColor: '#00dca8', gradeDesc: 'Your finances are in great shape! Keep it up.' };
  if (score >= 70) return { grade: '✅ Good',       gradeColor: '#22c55e', gradeDesc: 'You are managing well with room to improve.' };
  if (score >= 55) return { grade: '🟡 Average',    gradeColor: '#f59e0b', gradeDesc: 'Some areas need attention. Small fixes go far.' };
  if (score >= 40) return { grade: '⚠️ Below Average', gradeColor: '#f97316', gradeDesc: 'Take corrective action now to prevent stress later.' };
  return             { grade: '🚨 Critical',    gradeColor: '#ef4444', gradeDesc: 'Your finances need urgent attention and restructuring.' };
}

function buildProjection(initial, monthly, years, annualReturn) {
  const monthlyReturn = annualReturn / 12;
  const data = [];
  let balance = initial;
  for (let m = 0; m <= years * 12; m += 6) {
    data.push({ month: m, balance: Math.round(balance) });
    for (let i = 0; i < 6; i++) {
      balance = balance * (1 + monthlyReturn) + monthly;
    }
  }
  return data;
}

function buildAdvice({ savingsRate, debtToIncome, emergencyMonths, needsPct, monthlySavings, recommendedSip, sip, sipAffordable, income, totalExpenses, overSpend }) {
  const recs = [];
  const problems = [];
  let warning = null;

  // Savings
  if (savingsRate < 10) {
    problems.push(`Very low savings rate (${savingsRate}%). Aim for at least 20%.`);
    recs.push(`Try to cut ₹${Math.round(income * 0.1).toLocaleString('en-IN')} from non-essentials to boost savings.`);
    warning = 'Your savings rate is critically low — this puts your financial security at risk.';
  } else if (savingsRate < 20) {
    problems.push(`Savings rate (${savingsRate}%) is below the ideal 20%.`);
    recs.push(`Increase savings by ₹${Math.round((income * 0.20) - (income * savingsRate / 100)).toLocaleString('en-IN')}/month to hit 20%.`);
  }

  // Emergency Fund
  if (emergencyMonths < 3) {
    problems.push('Emergency fund covers less than 3 months of income — very risky.');
    recs.push('Build a 6-month emergency fund in a high-interest savings account or liquid fund.');
    if (!warning) warning = 'No/low emergency fund — one unexpected event could cause serious financial strain.';
  } else if (emergencyMonths < 6) {
    recs.push(`Your emergency fund covers ${emergencyMonths.toFixed(1)} months. Target 6 months.`);
  }

  // Debt
  if (debtToIncome > 35) {
    problems.push(`High Debt-to-Income ratio (${debtToIncome.toFixed(0)}%). Above 35% is dangerous.`);
    recs.push('Prioritize paying down high-interest debts (personal loans, credit cards) first.');
    if (!warning) warning = `High EMI burden (${debtToIncome.toFixed(0)}% of income). Reduce debt before increasing lifestyle spending.`;
  } else if (debtToIncome > 20) {
    problems.push(`Moderate debt load (${debtToIncome.toFixed(0)}% of income). Manage carefully.`);
  }

  // Overspending
  if (overSpend.length > 0) {
    overSpend.forEach(o => problems.push(`Overspending: ${o}`));
    recs.push('Review discretionary spending. Even ₹500–₹2,000/month saved compounds significantly over time.');
  }

  // SIP
  if (sip === 0) {
    recs.push(`Start a SIP of at least ${fmt(recommendedSip)}/month in a diversified equity mutual fund.`);
  } else if (sip < recommendedSip * 0.7) {
    recs.push(`Consider increasing your SIP from ${fmt(sip)} to ${fmt(recommendedSip)} for better wealth creation.`);
  }

  if (needsPct > 60) {
    recs.push('Your essential expenses are high. Consider refinancing loans or moving to a more affordable rental.');
  }

  // Positive
  if (problems.length === 0) {
    problems.push('No major financial red flags detected — excellent discipline!');
  }
  if (recs.length === 0) {
    recs.push('Maintain current discipline. Consider increasing SIP allocation as income grows.');
  }

  // Prediction
  const delta = monthlySavings;
  let prediction;
  if (delta >= income * 0.20) {
    prediction = `At this savings rate, you will accumulate ${fmt(delta * 12)} in a year. Stay consistent!`;
  } else if (delta > 0) {
    prediction = `You'll save ${fmt(delta * 12)} this year. With 20% savings discipline, you could save ${fmt(income * 0.20 * 12)} — a difference of ${fmt((income * 0.20 - delta) * 12)}.`;
  } else {
    prediction = `⚠️ At current spending levels, you will run out of money before month-end. Immediate expense reduction is needed.`;
  }

  const smartTip = getSmartTip(savingsRate, debtToIncome, emergencyMonths, sip);

  return { recs, problems, warning, prediction, smartTip };
}

function getSmartTip(savingsRate, debtToIncome, emergencyMonths, sip) {
  if (sip === 0) return '💡 The best time to start a SIP was yesterday. The second best time is today. Even ₹500/month in an index fund grows to ₹3.5 lakh in 15 years at 12% return!';
  if (emergencyMonths < 3) return '💡 Park your emergency fund in a liquid mutual fund — you get better returns than savings accounts and can withdraw in 24 hours.';
  if (debtToIncome > 30) return '💡 Pay more than the minimum EMI when possible. Even ₹1,000 extra/month on a ₹5L loan saves ~₹8,000 in interest!';
  if (savingsRate < 15) return '💡 Try the "Pay Yourself First" trick — auto-transfer savings on salary day before spending. What you don\'t see, you don\'t spend.';
  return '💡 As your income grows, avoid lifestyle inflation. Direct 50% of every salary hike straight into investments — this alone creates wealth over time.';
}

/* ===================================================
   CHART RENDERING
   =================================================== */
function renderCharts(result) {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? 'rgba(240,244,255,0.6)' : 'rgba(10,17,40,0.6)';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';

  Chart.defaults.color = textColor;
  Chart.defaults.font.family = 'Outfit';

  // Destroy previous
  Object.values(charts).forEach(c => c?.destroy());
  charts = {};

  // 1. Expense Donut
  const expLabels = ['Rent/EMI','Food','Transport','Utilities','Healthcare','Education','Loans','Entertainment','Shopping'];
  const expData = [
    result.expenses.rent, result.expenses.food, result.expenses.transport,
    result.expenses.utilities, result.expenses.healthcare, result.expenses.education,
    result.expenses.emi, result.expenses.entertainment, result.expenses.shopping
  ].map(v => Math.round(v));

  const ctx1 = $('expense-chart').getContext('2d');
  charts.expense = new Chart(ctx1, {
    type: 'doughnut',
    data: {
      labels: expLabels,
      datasets: [{
        data: expData,
        backgroundColor: CHART_PALETTE,
        borderColor: 'transparent',
        hoverOffset: 8,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} (${pct(ctx.raw, result.totalExpenses)}%)`
          }
        }
      },
      animation: { animateRotate: true, duration: 900 }
    }
  });

  // 2. Budget Bar (actual vs ideal 50-30-20)
  const ctx2 = $('budget-chart').getContext('2d');
  const budgetCategories = ['Needs (50%)', 'Wants (30%)', 'Savings (20%)'];
  const actualPcts = [
    pct(result.needs, result.income),
    pct(result.wants, result.income),
    pct(result.monthlySavings, result.income)
  ];
  const idealPcts = [50, 30, 20];

  charts.budget = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: budgetCategories,
      datasets: [
        {
          label: 'Your %',
          data: actualPcts,
          backgroundColor: [
            'rgba(0, 220, 168, 0.7)',
            'rgba(168, 85, 247, 0.7)',
            'rgba(59, 130, 246, 0.7)'
          ],
          borderRadius: 8,
          borderSkipped: false,
        },
        {
          label: 'Ideal %',
          data: idealPcts,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          borderRadius: 8,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: gridColor },
          ticks: { callback: v => v + '%', font: { size: 10 } },
          max: 100
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw}%` } }
      },
      animation: { duration: 900 }
    }
  });

  // 3. Growth Projection Line
  const ctx3 = $('growth-chart').getContext('2d');
  const proj = result.projection;
  const projLabels = proj.map(p => {
    const now = new Date(2026, 8, 11); // Sep 2026
    const d = new Date(now.getFullYear(), now.getMonth() + p.month, 1);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });
  const projValues = proj.map(p => p.balance);

  const gradient3 = ctx3.createLinearGradient(0, 0, 0, 220);
  gradient3.addColorStop(0, 'rgba(0, 220, 168, 0.3)');
  gradient3.addColorStop(1, 'rgba(0, 220, 168, 0)');

  charts.growth = new Chart(ctx3, {
    type: 'line',
    data: {
      labels: projLabels,
      datasets: [{
        label: 'Portfolio Value',
        data: projValues,
        borderColor: '#00dca8',
        backgroundColor: gradient3,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#00dca8',
        pointRadius: 4,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 9 }, maxRotation: 30 } },
        y: {
          grid: { color: gridColor },
          ticks: {
            callback: v => v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : `₹${(v/1000).toFixed(0)}K`,
            font: { size: 10 }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } }
      },
      animation: { duration: 1200 }
    }
  });
}

/* ===================================================
   SVG GRADIENT (for score ring)
   =================================================== */
function injectSvgGradient() {
  const svg = document.querySelector('.score-ring');
  if (!svg || svg.querySelector('#scoreGrad')) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00dca8"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>`;
  svg.insertBefore(defs, svg.firstChild);
}

/* ===================================================
   UI RENDER
   =================================================== */
function updateScoreRing(score) {
  const circumference = 2 * Math.PI * 50; // ~314
  const fill = $('score-ring-fill');
  const offset = circumference * (1 - score / 100);
  setTimeout(() => { fill.style.strokeDashoffset = offset; }, 100);
}

function renderDashboard(result) {
  // Date
  const now = new Date();
  $('dashboard-date').textContent = `Analysis for ${now.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}`;

  // Score
  $('health-score-val').textContent = result.score;
  $('score-grade').textContent = result.grade;
  $('score-grade').style.color = result.gradeColor;
  $('score-desc').textContent = result.gradeDesc;
  updateScoreRing(result.score);

  // KPIs
  $('kpi-income-val').textContent = fmt(result.income);
  $('kpi-expense-val').textContent = fmt(result.totalExpenses);
  $('kpi-savings-val').textContent = fmt(result.monthlySavings);
  $('kpi-rate-val').textContent = `${result.savingsRate}%`;

  // Color savings rate
  const rateEl = $('kpi-rate-val');
  rateEl.style.color = result.savingsRate >= 20 ? '#00dca8' : result.savingsRate >= 10 ? '#f59e0b' : '#ef4444';

  // Charts
  renderCharts(result);

  // Insights
  renderInsights(result);

  // Goals
  renderGoals(result);
}

function renderInsights(result) {
  const { advice, savingsRate, totalExpenses, income, recommendedSip, sip, debtToIncome, emergencyMonths } = result;

  const cards = [
    {
      type: 'summary',
      tag: '🧾 Summary',
      title: 'Financial Snapshot',
      body: `You are earning <strong>${fmt(income)}</strong>/month and spending <strong>${fmt(totalExpenses)}</strong>. 
             Your savings rate is <strong>${savingsRate}%</strong> — ideal is 20%+. 
             ${result.monthlySavings > 0 ? `You save <strong>${fmt(result.monthlySavings)}</strong> every month.` : '<strong>You are spending more than you earn!</strong>'}`
    },
    {
      type: 'insights',
      tag: '📊 Key Insights',
      title: 'What the Numbers Say',
      body: `<ul>
        <li>Needs (essentials): <strong>${pct(result.needs, income)}%</strong> of income — ideal 50%</li>
        <li>Wants (lifestyle): <strong>${pct(result.wants, income)}%</strong> of income — ideal 30%</li>
        <li>Savings: <strong>${savingsRate}%</strong> — ideal 20%</li>
        <li>Debt-to-Income: <strong>${result.debtToIncome.toFixed(0)}%</strong> — safe below 35%</li>
        <li>Emergency fund: <strong>${result.emergencyMonths.toFixed(1)} months</strong> — target 6 months</li>
      </ul>`
    },
    {
      type: 'problems',
      tag: '📉 Problem Areas',
      title: advice.problems.length > 1 ? 'Issues Detected' : 'You\'re Doing Well!',
      body: `<ul>${advice.problems.map(p => `<li>${p}</li>`).join('')}</ul>`
    },
    {
      type: 'recommendations',
      tag: '📈 Recommendations',
      title: 'Action Plan for You',
      body: `<ul>${advice.recs.map(r => `<li>${r}</li>`).join('')}</ul>`
    },
    {
      type: 'prediction',
      tag: '🔮 Prediction',
      title: 'What Lies Ahead',
      body: `<p>${advice.prediction}</p>
             <p style="margin-top:0.5rem;color:var(--text-secondary);font-size:0.85rem;">
               Projected portfolio in 5 years at 8% SIP return: <strong>${fmt(result.projection[result.projection.length - 1].balance)}</strong>
             </p>`
    },
    {
      type: 'tip',
      tag: '💡 Smart Tip',
      title: 'Pro Tip of the Day',
      body: `<p>${advice.smartTip}</p>`
    },
  ];

  if (advice.warning) {
    cards.push({
      type: 'warning',
      tag: '⚠️ Warning',
      title: 'Action Required',
      body: `<p>${advice.warning}</p>`
    });
  }

  const grid = $('insights-grid');
  grid.innerHTML = cards.map(c => `
    <div class="insight-card glass-card ${c.type}">
      <span class="insight-tag">${c.tag}</span>
      <h3 class="insight-title">${c.title}</h3>
      <div class="insight-body">${c.body}</div>
    </div>
  `).join('');
}

function renderGoals(result) {
  const { goals, monthlySavings } = result;
  const grid = $('goals-grid');

  if (!goals || goals.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:2rem;">No goals entered. Add financial goals above to track your progress!</p>`;
    return;
  }

  grid.innerHTML = goals.map(g => {
    const progress = g.target > 0 ? Math.min(100, pct(g.saved, g.target)) : 0;
    const remaining = Math.max(0, g.target - g.saved);
    const monthsNeeded = monthlySavings > 0 ? Math.ceil(remaining / (monthlySavings * 0.5)) : null;
    const monthlyNeeded = remaining > 0 ? Math.ceil(remaining / 24) : 0; // suggest 2-yr plan

    return `
      <div class="goal-card glass-card">
        <div class="goal-header">
          <span class="goal-name">🎯 ${escapeHTML(g.name)}</span>
          <span class="goal-pct">${progress}%</span>
        </div>
        <div class="goal-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHTML(g.name)} progress">
          <div class="goal-bar-fill" style="width:0" data-width="${progress}"></div>
        </div>
        <div class="goal-amounts">
          <span>Saved: <strong style="color:var(--accent-teal)">${fmt(g.saved)}</strong></span>
          <span>Target: ${fmt(g.target)}</span>
        </div>
        ${remaining > 0 ? `
          <div class="goal-eta">⏱️ ${monthsNeeded ? `~${monthsNeeded} months at current saving pace` : 'Set a savings goal to estimate timeline'}</div>
          <div class="goal-monthly">Suggested: ${fmt(monthlyNeeded)}/month for 2-year plan</div>
        ` : `<div class="goal-eta" style="color:var(--accent-teal)">✅ Goal Achieved!</div>`}
      </div>
    `;
  }).join('');

  // Animate goal bars
  setTimeout(() => {
    document.querySelectorAll('.goal-bar-fill').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  }, 300);
}

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ===================================================
   DEMO DATA
   =================================================== */
function loadDemoData() {
  const demo = {
    'monthly-income': 65000,
    'other-income': 5000,
    'exp-rent': 18000,
    'exp-food': 9000,
    'exp-transport': 4000,
    'exp-utilities': 3000,
    'exp-healthcare': 1500,
    'exp-education': 5000,
    'exp-emi': 4000,
    'exp-entertainment': 4500,
    'exp-shopping': 3000,
    'current-savings': 80000,
    'monthly-sip': 3000,
    'total-debt': 250000,
    'debt-emi': 8000,
    'goal-name-1': 'Emergency Fund',
    'goal-target-1': 120000,
    'goal-saved-1': 80000,
    'goal-name-2': 'Family Vacation',
    'goal-target-2': 80000,
    'goal-saved-2': 15000,
  };
  Object.entries(demo).forEach(([k, v]) => {
    const el = document.querySelector(`[name="${k}"]`) || document.querySelector(`#${k}`);
    if (el) el.value = v;
  });
}

/* ===================================================
   THEME TOGGLE
   =================================================== */
function initTheme() {
  const btn = $('theme-toggle');
  const icon = btn.querySelector('.theme-icon');
  const root = document.documentElement;

  // Default: dark
  root.setAttribute('data-theme', 'dark');

  btn.addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') !== 'light';
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
    icon.textContent = isDark ? '☀️' : '🌙';

    // Re-render charts with new colours
    if (charts.expense) {
      const result = window.__lastResult;
      if (result) renderCharts(result);
    }
  });
}

/* ===================================================
   FORM SUBMIT
   =================================================== */
async function handleSubmit(e) {
  e.preventDefault();

  const income = parseFloat($('monthly-income')?.value);
  if (!income || income <= 0) {
    $('monthly-income').focus();
    $('monthly-income').style.borderColor = '#ef4444';
    setTimeout(() => ($('monthly-income').style.borderColor = ''), 2000);
    return;
  }

  // Button loading state
  const btn = $('analyze-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoad = btn.querySelector('.btn-loading');
  btnText.classList.add('hidden');
  btnLoad.classList.remove('hidden');
  btn.disabled = true;

  // Small delay for effect
  await new Promise(r => setTimeout(r, 700));

  const data = extractFormData();
  const result = analyse(data);
  window.__lastResult = result;

  // Show dashboard
  const dash = $('dashboard');
  dash.hidden = false;

  injectSvgGradient();
  renderDashboard(result);

  // Reset button
  btnText.classList.remove('hidden');
  btnLoad.classList.add('hidden');
  btn.disabled = false;

  // Scroll to dashboard
  setTimeout(() => {
    dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

/* ===================================================
   INIT
   =================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  injectSvgGradient();

  $('finance-form').addEventListener('submit', handleSubmit);

  $('demo-btn').addEventListener('click', () => {
    loadDemoData();
    $('analyze-btn').click();
  });

  // Smooth nav scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
