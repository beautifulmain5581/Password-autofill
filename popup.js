// Popup Script for Settings Management & Digital Assignments

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const vtopUsernameInput = document.getElementById('vtopUsername');
  const vtopPasswordInput = document.getElementById('vtopPassword');
  const autoSelectStudentCheckbox = document.getElementById('autoSelectStudent');
  const autoSolveCaptchaCheckbox = document.getElementById('autoSolveCaptcha');
  const autoSubmitVtopCheckbox = document.getElementById('autoSubmitVtop');
  const autoFocusCaptchaCheckbox = document.getElementById('autoFocusCaptcha');

  const wifiUsernameInput = document.getElementById('wifiUsername');
  const wifiPasswordInput = document.getElementById('wifiPassword');
  const autoSubmitWifiCheckbox = document.getElementById('autoSubmitWifi');

  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // Load Saved Values
  chrome.storage.local.get({
    vtopUsername: '',
    vtopPassword: '',
    autoSelectStudent: true,
    autoSolveCaptcha: true,
    autoSubmitVtop: true,
    autoFocusCaptcha: true,
    wifiUsername: '',
    wifiPassword: '',
    autoSubmitWifi: true
  }, (items) => {
    vtopUsernameInput.value = items.vtopUsername || '';
    vtopPasswordInput.value = items.vtopPassword || '';
    autoSelectStudentCheckbox.checked = items.autoSelectStudent !== false;
    autoSolveCaptchaCheckbox.checked = items.autoSolveCaptcha !== false;
    autoSubmitVtopCheckbox.checked = items.autoSubmitVtop !== false;
    autoFocusCaptchaCheckbox.checked = items.autoFocusCaptcha !== false;

    wifiUsernameInput.value = items.wifiUsername || '';
    wifiPasswordInput.value = items.wifiPassword || '';
    autoSubmitWifiCheckbox.checked = items.autoSubmitWifi !== false;
  });

  // Tab Switching
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      if (targetId === 'da-tab') {
        loadAssignments();
      }
    });
  });

  // Preload assignments if stored
  loadAssignments();

  // Toggle Password Visibility
  const toggleButtons = document.querySelectorAll('.toggle-password');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🔒';
        } else {
          input.type = 'password';
          btn.textContent = '👁';
        }
      }
    });
  });

  // Save Settings Function
  function saveSettings() {
    const settings = {
      vtopUsername: vtopUsernameInput.value.trim(),
      vtopPassword: vtopPasswordInput.value,
      autoSelectStudent: autoSelectStudentCheckbox.checked,
      autoSolveCaptcha: autoSolveCaptchaCheckbox.checked,
      autoSubmitVtop: autoSubmitVtopCheckbox.checked,
      autoFocusCaptcha: autoFocusCaptchaCheckbox.checked,
      autoSubmitCaptcha6: true,
      wifiUsername: wifiUsernameInput.value.trim(),
      wifiPassword: wifiPasswordInput.value,
      autoSubmitWifi: autoSubmitWifiCheckbox.checked
    };

    chrome.storage.local.set(settings, () => {
      saveStatus.textContent = 'Saved successfully! ✓';
      saveStatus.style.color = '#34d399';
      saveStatus.style.opacity = '1';

      setTimeout(() => {
        saveStatus.style.opacity = '0';
      }, 2500);
    });
  }

  saveBtn.addEventListener('click', saveSettings);

  // Allow pressing Enter in inputs to save
  const allInputs = document.querySelectorAll('input');
  allInputs.forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveSettings();
      }
    });
  });

  // --- RENDER DIGITAL ASSIGNMENTS IN POPUP ---
  function loadAssignments() {
    const container = document.getElementById('daListContainer');
    const lastUpdatedEl = document.getElementById('daLastUpdated');
    if (!container) return;

    chrome.storage.local.get(['vtopDaCourses', 'vtopDaLastUpdated'], (data) => {
      const courses = data.vtopDaCourses || [];
      const lastUpdated = data.vtopDaLastUpdated;

      if (lastUpdated && lastUpdatedEl) {
        const d = new Date(lastUpdated);
        lastUpdatedEl.textContent = `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }

      if (courses.length === 0) {
        container.innerHTML = `
          <div class="da-empty-state">
            <span>📋</span>
            <p>No assignment data synced yet.<br>Open <strong>Digital Assignment Upload</strong> in VTOP to track your deadlines.</p>
          </div>
        `;
        return;
      }

      // Separate pending vs completed courses
      const pendingCourses = courses.filter(c => c && c.nextDue);
      const completedCourses = courses.filter(c => c && !c.nextDue && c.totalAssignments > 0);

      pendingCourses.sort((a, b) => a.nextDue.daysLeft - b.nextDue.daysLeft);

      let html = '';

      if (pendingCourses.length === 0) {
        html += `
          <div class="da-empty-state" style="border-color: rgba(16, 185, 129, 0.4);">
            <span style="color: #34d399;">🎉</span>
            <p><strong style="color: #ffffff;">You're all caught up!</strong><br>All digital assignments for this semester have been uploaded.</p>
          </div>
        `;
      } else {
        pendingCourses.forEach(c => {
          const due = c.nextDue;
          const days = due.daysLeft;

          let badgeClass = 'da-badge-calm';
          let daysLabel = `${days}d left`;
          if (days === 0) {
            badgeClass = 'da-badge-urgent';
            daysLabel = 'Today!';
          } else if (days <= 3) {
            badgeClass = 'da-badge-urgent';
            daysLabel = `${days}d left`;
          } else if (days <= 7) {
            badgeClass = 'da-badge-warning';
            daysLabel = `${days}d left`;
          }

          html += `
            <div class="da-card">
              <div class="da-card-info">
                <span class="da-card-code">${escapeHtml(c.courseCode)}</span>
                <span class="da-card-title">${escapeHtml(c.courseTitle)}</span>
                <span class="da-card-assign">📄 ${escapeHtml(due.title)} (${due.maxMark} Marks)</span>
              </div>
              <div class="da-card-badge ${badgeClass}">
                <span class="da-badge-date">${escapeHtml(due.dueDateStr)}</span>
                <span class="da-badge-days">${daysLabel}</span>
              </div>
            </div>
          `;
        });
      }

      // Completed courses section
      if (completedCourses.length > 0) {
        completedCourses.forEach(c => {
          html += `
            <div class="da-card" style="opacity: 0.85;">
              <div class="da-card-info">
                <span class="da-card-code" style="color: #94a3b8;">${escapeHtml(c.courseCode)}</span>
                <span class="da-card-title">${escapeHtml(c.courseTitle)}</span>
                <span class="da-card-assign" style="color: #34d399;">✓ All ${c.totalAssignments} Submitted</span>
              </div>
              <div class="da-card-badge da-badge-done">
                <span class="da-badge-date">Completed</span>
                <span class="da-badge-days">Nothing Left</span>
              </div>
            </div>
          `;
        });
      }

      container.innerHTML = html;
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
