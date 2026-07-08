// =====================================================
// Questionnaire Wizard for Compliance Profiler
// =====================================================

let questionsData = null;
let currentRegIndex = 0;
let currentQIndex = 0;
let questionAnswers = {};

async function loadQuestions() {
  try {
    const resp = await fetch('./questions.json?t=' + Date.now());
    questionsData = await resp.json();
    window.__questionsData = questionsData; // expose for compliance page
  } catch (e) {
    console.warn('Questions file not found, skipping questionnaire.');
    questionsData = null;
  }
}

function getApplicableRegulations() {
  if (!questionsData) { console.warn('⚠️ getApplicableRegulations: questionsData is null'); return []; }
  const hazards = getSelectedHazards();
  const profile = JSON.parse(localStorage.getItem('safety_hub_osh_profile') || '[]');
  const allTriggers = [...hazards, ...profile];
  const matched = questionsData.regulations.filter(r =>
    r.trigger === 'all' || allTriggers.includes(r.trigger)
  );
  console.log('🔍 getApplicableRegulations:', { hazards, profile, matched: matched.map(r => r.id), total: questionsData.regulations.length });
  return matched;
}

function getSelectedHazards() {
  const hazards = [];
  const ids = ['noise', 'chemicals', 'machinery', 'lifting', 'toxic', 'radiation'];
  ids.forEach(id => {
    const el = document.getElementById('hazard-' + id);
    const localVal = localStorage.getItem('safety_hub_hazard_' + id);
    if (el) {
      if (el.checked) hazards.push(id);
    } else if (localVal === 'true') {
      hazards.push(id);
    }
  });
  console.log('🔍 getSelectedHazards:', { hazards, chemLocal: localStorage.getItem('safety_hub_hazard_chemicals'), chemCheckbox: document.getElementById('hazard-chemicals')?.checked });
  return hazards;
}

function hasQuestionnaire(trigger) {
  if (!questionsData) return false;
  return questionsData.regulations.some(r => r.trigger === trigger);
}

function renderRegulationSelector() {
  const regs = getApplicableRegulations();
  if (regs.length === 0) return null;

  let html = `
    <div class="profiler-section">
      <h3>📋 Regulatory Questionnaires</h3>
      <p style="margin-bottom: 16px; color: #666;">Complete the questionnaire for each applicable regulation to narrow down your compliance checklist.</p>
      <div class="reg-list" id="reg-list">`;

  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    const done = getQuestionnaireStatus(r.id);
    const statusIcon = done === 'complete' ? '✅' : done === 'started' ? '🔄' : '⬜';
    html += `
      <div class="reg-card ${done === 'complete' ? 'done' : ''}" onclick="startQuestionnaire(${i})" data-reg-index="${i}">
        <div class="reg-card-header">
          <span class="reg-icon">${r.icon}</span>
          <div class="reg-info">
            <h4>${r.title}</h4>
            <p>${r.full_title}</p>
          </div>
          <span class="reg-status">${statusIcon}</span>
        </div>
        <div class="reg-progress">
          <div class="reg-progress-bar" style="width: ${getQuestionnairePercent(r.id)}%"></div>
        </div>
      </div>`;
  }

  html += `</div></div>`;
  return html;
}

function getQuestionnaireStatus(regId) {
  let answers = {};
  try {
    answers = JSON.parse(localStorage.getItem('q_answers_' + regId) || '{}');
  } catch (e) {
    answers = {};
  }
  const reg = questionsData?.regulations.find(r => r.id === regId);
  if (!reg) return 'not_started';
  const total = reg.questions.length;
  const answered = Object.keys(answers).length;
  if (answered === 0) return 'not_started';
  if (answered >= total) return 'complete';
  return 'started';
}

function getQuestionnairePercent(regId) {
  const reg = questionsData?.regulations.find(r => r.id === regId);
  if (!reg || reg.questions.length === 0) return 0;
  let answers = {};
  try {
    answers = JSON.parse(localStorage.getItem('q_answers_' + regId) || '{}');
  } catch (e) {
    answers = {};
  }
  return Math.round((Object.keys(answers).length / reg.questions.length) * 100);
}

function showRegulationList() {
  const regs = getApplicableRegulations();
  const profilerDiv = document.getElementById('view-profiler');

  let regCards = regs.map((r, i) => {
    const done = getQuestionnaireStatus(r.id);
    const statusIcon = done === 'complete' ? '✅' : done === 'started' ? '🔄' : '⬜';
    const pct = getQuestionnairePercent(r.id);
    return `
      <div class="reg-card ${done === 'complete' ? 'done' : ''}" onclick="startQuestionnaire(${i})">
        <div class="reg-card-header">
          <span class="reg-icon">${r.icon}</span>
          <div class="reg-info">
            <h4>${r.title}</h4>
            <p>${r.full_title}</p>
          </div>
          <span class="reg-status">${statusIcon}</span>
        </div>
        <div class="reg-progress">
          <div class="reg-progress-bar" style="width: ${pct}%"></div>
        </div>
      </div>`;
  }).join('');

  profilerDiv.innerHTML = `
    <div class="questionnaire-container">
      <h2>📋 Regulatory Questionnaires</h2>
      <p style="margin-bottom: 20px;">Complete the questionnaire for each applicable regulation. This helps us show only what's relevant to your workplace.</p>
      ${regCards}
      <div style="display:flex; gap:12px; margin-top: 24px;">
        <button class="btn-action" onclick="exitAndGenerate()">⚡ Generate Register (Skip)</button>
        <button class="btn-action" style="background:var(--bg-card);color:var(--text);" onclick="switchToOriginalProfiler()">← Back to Profiler</button>
      </div>
    </div>
  `;
}

function switchToOriginalProfiler() {
  document.getElementById('view-profiler').innerHTML = originalProfilerHTML;
  renderRegulationCards();
  checkAllRegStatuses();
}

function startQuestionnaire(regIndex) {
  // Save headcount and industry
  const headcount = document.getElementById('profile-headcount')?.value;
  const industry = document.getElementById('profile-industry')?.value;
  if (headcount) localStorage.setItem('safety_hub_headcount', headcount);
  if (industry) localStorage.setItem('safety_hub_industry', industry);

  // Save environmental hazard checkboxes
  const hazards = ['noise', 'chemicals', 'machinery', 'lifting', 'toxic', 'radiation'];
  hazards.forEach(h => {
    const el = document.getElementById(`hazard-${h}`);
    if (el) {
      localStorage.setItem(`safety_hub_hazard_${h}`, el.checked ? 'true' : 'false');
    }
  });

  // Save selected operational cards
  const selected = [];
  document.querySelectorAll('.profile-card.selected').forEach(card => {
    selected.push(card.getAttribute('data-id'));
  });
  localStorage.setItem('safety_hub_osh_profile', JSON.stringify(selected));

  currentRegIndex = regIndex;
  currentQIndex = 0;
  const reg = getApplicableRegulations()[regIndex];
  try {
    questionAnswers = JSON.parse(localStorage.getItem('q_answers_' + reg.id) || '{}');
  } catch (e) {
    questionAnswers = {};
  }

  // Resume from first unanswered question
  for (let i = 0; i < reg.questions.length; i++) {
    if (!questionAnswers[reg.questions[i].id]) {
      currentQIndex = i;
      break;
    }
  }

  renderQuestion();
}

function renderQuestion() {
  const regs = getApplicableRegulations();
  const reg = regs[currentRegIndex];
  if (!reg) return;
  const q = reg.questions[currentQIndex];
  const total = reg.questions.length;
  const answered = Object.keys(questionAnswers).length;
  const existing = questionAnswers[q.id];

  switchTab('profiler');

  const profilerDiv = document.getElementById('view-profiler');
  profilerDiv.innerHTML = `
    <div class="questionnaire-container" id="q-container" data-reg-index="${currentRegIndex}" data-q-index="${currentQIndex}">
      <div class="q-top-bar">
        <button class="q-back-btn" data-action="exit">← Back to Regulations</button>
        <span class="q-reg-title">${reg.icon} ${reg.title}</span>
      </div>

      <div class="q-progress-section">
        <div class="q-progress-text">Question ${currentQIndex + 1} of ${total}</div>
        <div class="q-progress-bar-bg">
          <div class="q-progress-bar-fill" style="width: ${Math.round((answered / total) * 100)}%"></div>
        </div>
      </div>

      <div class="q-card">
        <div class="q-reg-badge">${reg.icon}</div>
        <h2 class="q-question">${q.question}</h2>
        <p class="q-detail">${q.detail}</p>

        <div class="q-actions" data-action-group="answer">
          <button class="q-btn q-btn-yes ${existing === 'yes' ? 'active' : ''}" data-value="yes">
            <span class="q-btn-icon">✅</span> Yes, in place
          </button>
          <button class="q-btn q-btn-no ${existing === 'no' ? 'active' : ''}" data-value="no">
            <span class="q-btn-icon">❌</span> Not yet
          </button>
          <button class="q-btn q-btn-skip ${existing === 'skip' ? 'active' : ''}" data-value="skip">
            <span class="q-btn-icon">⏭️</span> Skip
          </button>
        </div>

        <div id="q-action-steps" class="q-action-steps" style="display: ${existing === 'no' ? 'block' : 'none'}">
          <h4>📋 Required actions to comply:</h4>
          <ul>
            ${q.action_steps.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>

      <div class="q-nav">
        <button class="q-nav-btn" data-action="prev" ${currentQIndex === 0 ? 'disabled' : ''}>← Previous</button>
        <button class="q-nav-btn q-nav-next" data-action="next">${currentQIndex >= total - 1 ? '📊 View Summary' : 'Next →'}</button>
      </div>
    </div>
  `;

  // Attach event listeners via delegation
  const container = document.getElementById('q-container');
  if (!container) return;

  container.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action], [data-value]');
    if (!btn) return;

    const action = btn.dataset.action;
    const value = btn.dataset.value;

    if (value) {
      window.answerQuestion(value);
    } else if (action === 'exit') {
      window.exitQuestionnaire();
    } else if (action === 'prev') {
      window.prevQuestion();
    } else if (action === 'next') {
      window.nextOrFinish();
    }
  });
}

// Make functions globally accessible for backward compat
window.answerQuestion = function(value) {
  const regs = getApplicableRegulations();
  const reg = regs[currentRegIndex];
  if (!reg) return;
  const q = reg.questions[currentQIndex];
  if (!q) return;

  questionAnswers[q.id] = value;
  localStorage.setItem('q_answers_' + reg.id, JSON.stringify(questionAnswers));

  document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.q-btn[data-value="${value}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const steps = document.getElementById('q-action-steps');
  if (steps) {
    steps.style.display = value === 'no' ? 'block' : 'none';
  }
};

function nextQuestion() {
  const regs = getApplicableRegulations();
  const reg = regs[currentRegIndex];
  if (!reg) return;
  if (currentQIndex < reg.questions.length - 1) {
    currentQIndex++;
    renderQuestion();
  }
}

function prevQuestion() {
  if (currentQIndex > 0) {
    currentQIndex--;
    renderQuestion();
  }
}

function nextOrFinish() {
  const regs = getApplicableRegulations();
  const reg = regs[currentRegIndex];
  if (!reg) return;
  if (currentQIndex < reg.questions.length - 1) {
    nextQuestion();
  } else {
    showQuestionnaireSummary(currentRegIndex);
  }
}

function showQuestionnaireSummary(regIndex) {
  const regs = getApplicableRegulations();
  const reg = regs[regIndex];
  let answers = {};
  try {
    answers = JSON.parse(localStorage.getItem('q_answers_' + reg.id) || '{}');
  } catch (e) {
    answers = {};
  }

  const yes = Object.entries(answers).filter(([, v]) => v === 'yes').length;
  const no = Object.entries(answers).filter(([, v]) => v === 'no').length;
  const skip = Object.entries(answers).filter(([, v]) => v === 'skip').length;
  const total = reg.questions.length;
  const resolved = yes + no + skip;

  const profilerDiv = document.getElementById('view-profiler');
  let qHtml = reg.questions.map(q => {
    const ans = answers[q.id] || 'unanswered';
    const icon = ans === 'yes' ? '✅' : ans === 'no' ? '❌' : ans === 'skip' ? '⏭️' : '⬜';
    return `<div class="q-summary-item ${ans}"><span class="q-summary-icon">${icon}</span><span>${q.question}</span></div>`;
  }).join('');

  profilerDiv.innerHTML = `
    <div class="questionnaire-container">
      <div class="q-top-bar">
        <button class="q-back-btn" onclick="exitQuestionnaire()">← Back to Regulations</button>
        <span class="q-reg-title">${reg.icon} ${reg.title}</span>
      </div>

      <div class="q-summary">
        <h2>📊 Questionnaire Summary</h2>
        <div class="q-summary-stats">
          <div class="q-stat"><span class="q-stat-num">${resolved}/${total}</span> Answered</div>
          <div class="q-stat good"><span class="q-stat-num">${yes}</span> Compliant</div>
          <div class="q-stat warn"><span class="q-stat-num">${no}</span> Action Needed</div>
          <div class="q-stat muted"><span class="q-stat-num">${skip}</span> Skipped</div>
        </div>
        <div class="q-summary-list">${qHtml}</div>
        <div style="text-align:center; margin-top: 24px;">
          <button class="btn-action" onclick="exitAndGenerate()">⚡ Generate Legal Register</button>
          <button class="btn-action" style="background:var(--bg-card); color:var(--text); margin-left: 12px;" onclick="reviewQuestionnaire(${regIndex})">✏️ Review Answers</button>
        </div>
      </div>
    </div>
  `;
}

function reviewQuestionnaire(regIndex) {
  currentRegIndex = regIndex;
  currentQIndex = 0;
  renderQuestion();
}

function exitQuestionnaire() {
  const profilerDiv = document.getElementById('view-profiler');
  profilerDiv.innerHTML = originalProfilerHTML;
  // Restore profiler state
  renderRegulationCards();
  checkAllRegStatuses();
}

function exitAndGenerate(skipPrompt) {
  const regs = getApplicableRegulations();
  let allDone = true;
  for (const r of regs) {
    if (getQuestionnaireStatus(r.id) !== 'complete') {
      allDone = false;
      break;
    }
  }

  if (!allDone && !skipPrompt) {
    if (!confirm('Some questionnaires are not fully answered. Generate register anyway?')) {
      return;
    }
  }

  // Restore profiler HTML first
  const profilerDiv = document.getElementById('view-profiler');
  if (profilerDiv && originalProfilerHTML) {
    profilerDiv.innerHTML = originalProfilerHTML;
  }

  // Directly switch to register and load, bypassing the overridden generateComplianceRegister
  switchTab('register');
}

 function renderRegulationCards() {
   console.log('🔍 renderRegulationCards fired');
   const bioSection = document.querySelector('.biodata-form');
   if (!bioSection) { console.warn('⚠️ .biodata-form not found'); return; }
   const existing = document.querySelector('.reg-list-section');
   if (existing) existing.remove();

   const regs = getApplicableRegulations();
   console.log('🔍 renderRegulationCards: regs:', regs.length, regs.map(r => r.id));
   if (regs.length === 0) { console.warn('⚠️ no applicable regs — cards not rendered'); return; }

   const section = document.createElement('div');
   section.className = 'reg-list-section';
   section.innerHTML = renderRegulationSelector();
   bioSection.after(section);
   console.log('✅ regulation cards inserted into DOM');
 }

function checkAllRegStatuses() {
  const regs = getApplicableRegulations();
  for (const r of regs) {
    const cards = document.querySelectorAll('.reg-card');
    cards.forEach(c => {
      const idx = parseInt(c.dataset.regIndex);
      if (idx >= 0 && idx < regs.length && regs[idx].id === r.id) {
        const done = getQuestionnaireStatus(r.id);
        c.className = 'reg-card' + (done === 'complete' ? ' done' : '');
        c.querySelector('.reg-status').textContent = done === 'complete' ? '✅' : done === 'started' ? '🔄' : '⬜';
        c.querySelector('.reg-progress-bar').style.width = getQuestionnairePercent(r.id) + '%';
      }
    });
  }
}

let originalProfilerHTML = '';

function initQuestionnaire() {
  console.log('📌 initQuestionnaire called');
  loadQuestions().then(() => {
    console.log('📌 questions loaded, regs:', questionsData?.regulations?.length);
    const profilerDiv = document.getElementById('view-profiler');
    if (!profilerDiv) { console.warn('⚠️ view-profiler not found in DOM'); return; }
    originalProfilerHTML = profilerDiv.innerHTML;
    console.log('📌 originalProfilerHTML captured, calling renderRegulationCards...');

    renderRegulationCards();
    console.log('📌 renderRegulationCards done, checking DOM for .reg-list-section:', !!document.querySelector('.reg-list-section'));

    // Override the generate function trigger
    const originalGenerate = window.generateComplianceRegister;
    window.generateComplianceRegister = function() {
      // Save headcount and industry
      const headcount = document.getElementById('profile-headcount')?.value;
      const industry = document.getElementById('profile-industry')?.value;
      if (headcount) localStorage.setItem('safety_hub_headcount', headcount);
      if (industry) localStorage.setItem('safety_hub_industry', industry);

      // Save environmental hazard checkboxes
      const hazards = ['noise', 'chemicals', 'machinery', 'lifting', 'toxic', 'radiation'];
      hazards.forEach(h => {
        const el = document.getElementById(`hazard-${h}`);
        if (el) {
          localStorage.setItem(`safety_hub_hazard_${h}`, el.checked ? 'true' : 'false');
        }
      });

      // Save selected operational cards
      const selected = [];
      document.querySelectorAll('.profile-card.selected').forEach(card => {
        selected.push(card.getAttribute('data-id'));
      });
      localStorage.setItem('safety_hub_osh_profile', JSON.stringify(selected));

      const regs = getApplicableRegulations();
      if (regs.length > 0) {
        showRegulationList();
      } else {
        originalGenerate();
      }
    };

    // Re-render reg cards when hazard checkboxes change (delegated — survives HTML replacement)
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id && e.target.id.startsWith('hazard-')) {
        renderRegulationCards();
      }
    });
  });
}

// Init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuestionnaire);
} else {
  initQuestionnaire();
}
