// VTOP Digital Assignments Due Tracker
// Scans assignment deadlines on the Assignment Upload page,
// renders urgency status tags in a clean column, and injects
// nav shortcuts to Assignments and Marks pages.

(function () {
  'use strict';

  if (window.__vit_vtop_da_initialized) return;
  window.__vit_vtop_da_initialized = true;

  let isScanning = false;
  let cachedDaResults = [];

  // ─── INIT ─────────────────────────────────────────────────────────────────

  function initDaTracker() {
    checkAndProcessPage();

    const observer = new MutationObserver(() => {
      checkAndProcessPage();
    });

    const root = document.getElementById('page-wrapper') ||
                 document.getElementById('main-section') ||
                 document.body;
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }

    setInterval(checkAndProcessPage, 800);
  }

  // ─── PAGE CHECK ───────────────────────────────────────────────────────────

  function checkAndProcessPage() {
    // Navbar shortcuts run on every VTOP page
    injectNavbarShortcuts();

    // DA main table scan
    const semesterSelect = document.getElementById('semesterSubId');
    const courseTable = findCourseTable();

    if (semesterSelect && courseTable) {
      const currentSemester = semesterSelect.value || '';
      if (
        currentSemester &&
        (!courseTable.dataset.vitDaProcessed ||
          courseTable.dataset.vitDaSemester !== currentSemester)
      ) {
        if (!isScanning) {
          processAssignmentUploadTable(courseTable, currentSemester);
        }
      }
    }

    // DA detail page highlight
    highlightPendingDetailsPage();

    // Dashboard forthcoming widget
    processDashboardForthcomingAssignments();
  }

  // ─── FIND TABLES ──────────────────────────────────────────────────────────

  function findCourseTable() {
    // Prefer VTOP-specific table classes to avoid matching the Marks outer table
    // which also contains "Course Code", "Class Nbr", "Course Title"
    const specificTables = Array.from(
      document.querySelectorAll('table.customTable, table.table-hover, table.table-bordered, table.table')
    );
    const allTables = Array.from(document.querySelectorAll('table'));
    const candidates = specificTables.length > 0 ? specificTables : allTables;

    for (const tbl of candidates) {
      const text = tbl.innerText || '';
      if (
        text.includes('Course Code') &&
        text.includes('Class Nbr') &&
        text.includes('Course Title')
      ) {
        // Confirm this is the DA upload table by checking for dashboard/upload button
        // and that it has the semester select on the page
        const semSelect = document.getElementById('semesterSubId');
        if (!semSelect) return null; // Not on the DA upload page
        return tbl;
      }
    }
    return null;
  }

  // ─── PROCESS ASSIGNMENT TABLE ─────────────────────────────────────────────

  async function processAssignmentUploadTable(table, semesterId) {
    if (isScanning) return;
    isScanning = true;
    table.dataset.vitDaProcessed = 'true';
    table.dataset.vitDaSemester = semesterId;

    const regNo = getAuthorizedId();
    const csrfToken = getCsrfToken();

    const headerRow =
      table.querySelector('thead tr, tr.tableHeader') || table.querySelector('tr');
    if (!headerRow) {
      isScanning = false;
      return;
    }

    const bodyRows = Array.from(
      table.querySelectorAll('tbody tr, tr.tableContent')
    ).filter((tr) => {
      const tds = tr.querySelectorAll('td');
      return tds.length >= 5 && /VL\d{8,}/.test(tds[1]?.innerText || '');
    });

    if (bodyRows.length === 0) {
      isScanning = false;
      return;
    }

    // Insert or find "Upcoming Dues" header column
    let dueColIndex = findDuesHeaderIndex(headerRow);
    if (dueColIndex === -1) {
      dueColIndex = insertDuesHeader(headerRow);
    }

    // Loading state cells
    bodyRows.forEach((row) => {
      let cell = row.children[dueColIndex];
      if (!cell || !cell.classList.contains('vit-da-cell')) {
        cell = document.createElement('td');
        cell.className = 'vit-da-cell';
        cell.style.cssText = 'text-align:center;vertical-align:middle;padding:8px 6px;';
        cell.innerHTML = `<span class="vit-status-tag vit-status-idle">—</span>`;
        if (row.children.length > dueColIndex) {
          row.insertBefore(cell, row.children[dueColIndex]);
        } else {
          row.appendChild(cell);
        }
      }
    });

    // Fetch all courses in parallel
    const coursePromises = bodyRows.map(async (row) => {
      const classId = row.children[1]?.innerText.trim() || '';
      const courseCode = row.children[2]?.innerText.trim() || '';
      const courseTitle = row.children[3]?.innerText.trim() || '';
      const dueCell = row.children[dueColIndex];

      if (!classId) return null;

      try {
        const html = await fetchCourseAssignments(regNo, classId, csrfToken);
        const parsed = parseAssignmentDetails(html, courseCode, courseTitle, classId);
        renderDuesCell(dueCell, parsed);
        return parsed;
      } catch (err) {
        console.error('[VTOP AutoFill] Error fetching DA for', courseCode, err);
        if (dueCell) {
          dueCell.innerHTML = `<span class="vit-status-tag vit-status-idle" style="cursor:pointer;" title="Click to retry">Retry</span>`;
          dueCell.onclick = () => {
            table.dataset.vitDaProcessed = '';
            checkAndProcessPage();
          };
        }
        return null;
      }
    });

    const results = (await Promise.all(coursePromises)).filter(Boolean);
    cachedDaResults = results;
    isScanning = false;

    // Cache for popup
    chrome.storage.local.set({
      vtopDaCourses: results,
      vtopDaLastUpdated: Date.now(),
    });

    // Enable sort on click
    setupHeaderSorting(headerRow, dueColIndex, table);
  }

  // ─── FETCH & PARSE ────────────────────────────────────────────────────────

  async function fetchCourseAssignments(regNo, classId, csrfToken) {
    const res = await fetch(
      `${window.location.origin}/vtop/examinations/processDigitalAssignment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `authorizedID=${encodeURIComponent(regNo)}&x=${encodeURIComponent(
          new Date().toGMTString()
        )}&classId=${encodeURIComponent(classId)}&_csrf=${encodeURIComponent(csrfToken)}`,
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function parseAssignmentDetails(htmlText, courseCode, courseTitle, classId) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const rows = Array.from(
      doc.querySelectorAll(
        'tr.fixedContent.tableContent, tr.tableContent, table tbody tr'
      )
    );
    const assignments = [];
    const pendingUpcoming = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 5) continue;

      const title = (cells[1]?.innerText || '').trim();
      if (!title || title.toLowerCase() === 'title') continue;

      const maxMark = (cells[2]?.innerText || '').trim();

      let dueDateStr = '';
      for (const c of cells) {
        const m = c.innerText.match(/\b\d{1,2}-[A-Za-z]{3}-\d{4}\b/);
        if (m) { dueDateStr = m[0]; break; }
      }
      if (!dueDateStr) continue;

      const dueDate = parseVtopDate(dueDateStr);
      if (!dueDate) continue;

      const lastUpdatedText = cells[6] ? cells[6].innerText.trim() : '';
      const hasDownloadBtn = row.querySelector(
        'button#downloadStudentDA, .fa-download, .bi-download, a[href*="download"], button[onclick*="download"]'
      );
      const isUploaded =
        Boolean(hasDownloadBtn) ||
        (lastUpdatedText && lastUpdatedText !== '-' && /\d{4}/.test(lastUpdatedText));

      const daysLeft = getDaysRemaining(dueDate);

      const item = { title, maxMark, dueDateStr, dueDateTimestamp: dueDate.getTime(), daysLeft, isUploaded };
      assignments.push(item);

      if (!isUploaded && daysLeft >= 0) {
        pendingUpcoming.push(item);
      }
    }

    pendingUpcoming.sort((a, b) => a.dueDateTimestamp - b.dueDateTimestamp);

    return {
      classId,
      courseCode,
      courseTitle,
      totalAssignments: assignments.length,
      nextDue: pendingUpcoming.length > 0 ? pendingUpcoming[0] : null,
      allCompleted: assignments.length > 0 && pendingUpcoming.length === 0,
      assignments,
    };
  }

  // ─── RENDER DUE CELL ──────────────────────────────────────────────────────

  function renderDuesCell(cell, data) {
    if (!cell || !data) return;

    if (data.nextDue) {
      const due = data.nextDue;
      const days = due.daysLeft;

      let tagClass = 'vit-status-safe';
      let tagText = `${days}d left`;

      if (days === 0) {
        tagClass = 'vit-status-urgent';
        tagText = 'Due Today';
      } else if (days === 1) {
        tagClass = 'vit-status-urgent';
        tagText = 'Tomorrow';
      } else if (days <= 3) {
        tagClass = 'vit-status-urgent';
        tagText = `${days} days left`;
      } else if (days <= 7) {
        tagClass = 'vit-status-warning';
        tagText = `${days} days left`;
      }

      cell.innerHTML = `
        <div class="vit-due-cell" title="Assignment: ${escapeHtml(due.title)}&#10;Due: ${due.dueDateStr}&#10;Max Marks: ${due.maxMark}">
          <span class="vit-due-date-text">${due.dueDateStr}</span>
          <span class="vit-status-tag ${tagClass}">${tagText}</span>
        </div>
      `;
      cell.setAttribute('data-days-left', days);
    } else {
      // All uploaded
      cell.innerHTML = `
        <div class="vit-due-cell">
          <span class="vit-status-tag vit-status-done">All Submitted</span>
        </div>
      `;
      cell.setAttribute('data-days-left', 9999);
    }
  }

  // ─── HEADER ───────────────────────────────────────────────────────────────

  function findDuesHeaderIndex(headerRow) {
    return Array.from(headerRow.children).findIndex(
      (th) => th.innerText && th.innerText.includes('Upcoming Dues')
    );
  }

  function insertDuesHeader(headerRow) {
    const th = document.createElement('th');
    th.className = 'vit-da-header';
    th.style.cssText = 'width:14%;text-align:center;vertical-align:middle;white-space:nowrap;cursor:pointer;';
    th.innerHTML = `
      <div class="vit-da-header-inner" title="Click to sort by deadline">
        <span>Upcoming Dues</span>
        <span class="vit-da-sort-icon">⇅</span>
      </div>
    `;
    // Insert after Course Title (index 3) → position 4
    if (headerRow.children.length > 4) {
      headerRow.insertBefore(th, headerRow.children[4]);
      return 4;
    } else {
      headerRow.appendChild(th);
      return headerRow.children.length - 1;
    }
  }

  // ─── SORT ─────────────────────────────────────────────────────────────────

  function setupHeaderSorting(headerRow, dueColIndex, table) {
    const th = headerRow.children[dueColIndex];
    if (!th || th.__vit_sort_attached) return;
    th.__vit_sort_attached = true;

    let sortAsc = true;
    th.addEventListener('click', () => {
      const tbody = table.querySelector('tbody') || table;
      const rows = Array.from(
        tbody.querySelectorAll('tr.tableContent, tbody tr')
      ).filter(
        (tr) =>
          tr.querySelectorAll('td').length >= 5 &&
          /VL\d{8,}/.test(tr.children[1]?.innerText || '')
      );

      rows.sort((a, b) => {
        const aVal = parseInt(a.children[dueColIndex]?.getAttribute('data-days-left') || '9999', 10);
        const bVal = parseInt(b.children[dueColIndex]?.getAttribute('data-days-left') || '9999', 10);
        return sortAsc ? aVal - bVal : bVal - aVal;
      });

      sortAsc = !sortAsc;
      const icon = th.querySelector('.vit-da-sort-icon');
      if (icon) icon.textContent = sortAsc ? '⇅' : (sortAsc === false ? '↑' : '↓');

      rows.forEach((r) => tbody.appendChild(r));
    });
  }

  // ─── DETAILS PAGE HIGHLIGHT ───────────────────────────────────────────────

  function highlightPendingDetailsPage() {
    const detailTables = Array.from(document.querySelectorAll('table'));
    const detailTable = detailTables.find((t) => {
      const text = t.innerText || '';
      return (
        text.includes('Max. Mark') &&
        text.includes('Weightage') &&
        text.includes('Document Details')
      );
    });

    if (!detailTable || detailTable.dataset.vitDaDetailHighlighted) return;
    detailTable.dataset.vitDaDetailHighlighted = 'true';

    const rows = Array.from(
      detailTable.querySelectorAll('tbody tr, tr.tableContent, tr')
    ).filter((r) => r.querySelectorAll('td').length >= 6);

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const lastUpdated = cells[6] ? cells[6].innerText.trim() : '';
      const downloadBtn = row.querySelector(
        'button#downloadStudentDA, .fa-download, .bi-download, a[href*="download"]'
      );
      const isUploaded =
        Boolean(downloadBtn) ||
        (lastUpdated !== '' && lastUpdated !== '-' && /\d{4}/.test(lastUpdated));

      let dueDateStr = '';
      for (const c of cells) {
        const m = c.innerText.match(/\b\d{1,2}-[A-Za-z]{3}-\d{4}\b/);
        if (m) { dueDateStr = m[0]; break; }
      }
      const dueDate = parseVtopDate(dueDateStr);
      const daysLeft = dueDate ? getDaysRemaining(dueDate) : null;

      if (!isUploaded && daysLeft !== null && daysLeft >= 0) {
        row.classList.add('vit-da-detail-pending-row');
        const titleCell = cells[1];
        if (titleCell && !titleCell.querySelector('.vit-da-pending-chip')) {
          const chip = document.createElement('span');
          chip.className = 'vit-da-pending-chip';
          chip.textContent = `Pending – ${daysLeft === 0 ? 'Due Today' : daysLeft + 'd left'}`;
          titleCell.appendChild(chip);
        }
      }
    });
  }

  // ─── NAVBAR SHORTCUTS ─────────────────────────────────────────────────────

  function injectNavbarShortcuts() {
    const alreadyHave = document.getElementById('vit-nav-shortcuts-group');
    if (alreadyHave) return;

    // Find the anchor point — either Campus Etiquette or Quick Links
    const etiquetteEl = Array.from(
      document.querySelectorAll('a, button, li, span')
    ).find((el) => (el.innerText || el.textContent || '').trim() === 'Campus Etiquette');

    const group = document.createElement('li');
    group.id = 'vit-nav-shortcuts-group';
    group.className = 'nav-item d-none d-md-flex align-items-center';
    group.style.cssText = 'gap:6px;margin:0 4px;';
    group.innerHTML = `
      <a href="#" role="button" id="vit-nav-assignments" class="vit-nav-shortcut" title="Digital Assignment Upload">
        Assignments
      </a>
      <a href="#" role="button" id="vit-nav-marks" class="vit-nav-shortcut" title="Examinations → Marks">
        Marks
      </a>
    `;

    group.querySelector('#vit-nav-assignments').addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('digital assignment upload', 'Academics');
    });

    group.querySelector('#vit-nav-marks').addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('marks', 'Examinations');
    });

    // Insert before Campus Etiquette if found
    if (etiquetteEl) {
      const parentLi = etiquetteEl.closest('li') || etiquetteEl.parentElement;
      if (parentLi && parentLi.parentElement) {
        parentLi.parentElement.insertBefore(group, parentLi);
        return;
      }
    }

    // Fallback: Quick Links area
    const quickLinks = document.getElementById('quickLinks');
    if (quickLinks && quickLinks.parentElement) {
      quickLinks.parentElement.insertBefore(group, quickLinks.nextSibling);
      return;
    }

    // Last resort: navbar
    const nav = document.querySelector('.navbar-nav.ms-auto, .navbar-nav');
    if (nav) nav.appendChild(group);
  }

  function dispatchFullClick(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      el.click();
    } catch (e) {
      console.warn('[VTOP AutoFill] Click error:', e);
    }
  }

  function navigateTo(targetText, menuText) {
    // ── MARKS SHORTCUT ──────────────────────────────────────────────────
    if (targetText === 'marks') {
      var directMarks = document.querySelector('a[data-url="examinations/StudentMarkView"], a[data-url*="StudentMarkView"]');
      if (directMarks) {
        dispatchFullClick(directMarks);
      }

      var allLinks = Array.from(document.querySelectorAll('a, button, .nav-link, span'));
      var examMenu = allLinks.find(function(a) {
        if (a.closest('#vit-nav-shortcuts-group')) return false;
        var t = (a.textContent || '').trim().toLowerCase();
        return t.includes('examination');
      });

      if (examMenu) {
        dispatchFullClick(examMenu);
        [150, 350, 600, 1000, 1500].forEach(function(delay) {
          setTimeout(function() {
            var item = document.querySelector('a[data-url="examinations/StudentMarkView"], a[data-url*="StudentMarkView"]') ||
                       Array.from(document.querySelectorAll('a.systemB5BtnMenu, a')).find(function(el) {
                         if (el.closest('#vit-nav-shortcuts-group')) return false;
                         var t = (el.textContent || '').trim().toLowerCase().replace(/[^a-z]/g, '');
                         return t === 'marks';
                       });
            if (item && !window.__vit_marks_nav_clicked) {
              window.__vit_marks_nav_clicked = true;
              setTimeout(function() { window.__vit_marks_nav_clicked = false; }, 3000);
              dispatchFullClick(item);
            }
          }, delay);
        });
      }
      return;
    }

    // ── ASSIGNMENTS SHORTCUT ─────────────────────────────────────────────
    if (targetText.includes('assignment')) {
      var directDa = document.querySelector('a[data-url*="doDigitalAssignment"], a[data-url*="DAUpload"]');
      if (directDa) {
        dispatchFullClick(directDa);
      }

      var allLinks = Array.from(document.querySelectorAll('a, button, .nav-link, span'));
      var acadMenu = allLinks.find(function(a) {
        if (a.closest('#vit-nav-shortcuts-group')) return false;
        var t = (a.textContent || '').trim().toLowerCase();
        return t.includes('academic');
      });

      if (acadMenu) {
        dispatchFullClick(acadMenu);
        [150, 350, 600, 1000, 1500].forEach(function(delay) {
          setTimeout(function() {
            var item = document.querySelector('a[data-url*="doDigitalAssignment"], a[data-url*="DAUpload"]') ||
                       Array.from(document.querySelectorAll('a.systemB5BtnMenu, a')).find(function(el) {
                         if (el.closest('#vit-nav-shortcuts-group')) return false;
                         var t = (el.textContent || '').trim().toLowerCase();
                         return t.includes('digital assignment upload');
                       });
            if (item && !window.__vit_da_nav_clicked) {
              window.__vit_da_nav_clicked = true;
              setTimeout(function() { window.__vit_da_nav_clicked = false; }, 3000);
              dispatchFullClick(item);
            }
          }, delay);
        });
      }
      return;
    }
  }

  // ─── DASHBOARD WIDGET ─────────────────────────────────────────────────────

  function processDashboardForthcomingAssignments() {
    const table = findForthcomingAssignmentsTable();
    if (!table || table.dataset.vitDashboardProcessed) return;
    table.dataset.vitDashboardProcessed = 'true';

    const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => {
      const tds = tr.querySelectorAll('td');
      return tds.length >= 4 && /^\d+$/.test(tds[0]?.innerText.trim());
    });

    if (rows.length === 0) return;

    const forthcomingItems = [];

    rows.forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      const courseName = tds[1]?.innerText.trim() || '';
      const title = tds[2]?.innerText.trim() || '';
      const lastDateStr = tds[3]?.innerText.trim() || '';
      const uploadedCell = tds[4];
      const isUploaded =
        uploadedCell &&
        (uploadedCell.innerText.toLowerCase().includes('yes') ||
          uploadedCell.innerText.toLowerCase().includes('uploaded') ||
          uploadedCell.querySelector('.fa-check, .bi-check, svg, img[src*="check"]') !== null);

      const dueDate = parseVtopDate(lastDateStr);
      if (!dueDate) return;

      const daysLeft = getDaysRemaining(dueDate);
      const lastDateCell = tds[3];

      let tagClass = 'vit-status-safe';
      let tagText = `${daysLeft}d left`;

      if (isUploaded) {
        tagClass = 'vit-status-done';
        tagText = 'Uploaded';
      } else if (daysLeft < 0) {
        tagClass = 'vit-status-urgent';
        tagText = 'Overdue';
      } else if (daysLeft === 0) {
        tagClass = 'vit-status-urgent';
        tagText = 'Due Today';
      } else if (daysLeft === 1) {
        tagClass = 'vit-status-urgent';
        tagText = 'Tomorrow';
      } else if (daysLeft <= 3) {
        tagClass = 'vit-status-urgent';
        tagText = `${daysLeft} days left`;
      } else if (daysLeft <= 7) {
        tagClass = 'vit-status-warning';
        tagText = `${daysLeft} days left`;
      }

      lastDateCell.innerHTML = `
        <div class="vit-due-cell" title="Course: ${escapeHtml(courseName)}&#10;Assignment: ${escapeHtml(title)}&#10;Last Date: ${lastDateStr}">
          <span class="vit-due-date-text">${lastDateStr}</span>
          <span class="vit-status-tag ${tagClass}">${tagText}</span>
        </div>
      `;

      forthcomingItems.push({
        courseCode: courseName.split(' ')[0] || courseName,
        courseTitle: courseName,
        title,
        dueDateStr: lastDateStr,
        daysLeft,
        isUploaded: Boolean(isUploaded),
        maxMark: '-',
      });
    });

    if (forthcomingItems.length > 0) {
      forthcomingItems.sort((a, b) => a.daysLeft - b.daysLeft);
      chrome.storage.local.get({ vitDaTrackerCache: [] }, (res) => {
        const existing = res.vitDaTrackerCache || [];
        if (existing.length === 0 || existing.every((x) => x.isUploaded)) {
          chrome.storage.local.set({
            vitDaTrackerCache: forthcomingItems,
            vitDaLastSynced: Date.now(),
            vitDaSemester: 'Dashboard',
          });
        }
      });
    }
  }

  function findForthcomingAssignmentsTable() {
    for (const tbl of document.querySelectorAll('table')) {
      const text = ((tbl.closest('.card, .widget, .box, div') || tbl).innerText + ' ' + tbl.innerText).toLowerCase();
      if (
        text.includes('forthcoming digital assignments') ||
        (text.includes('course name') && text.includes('last date') && text.includes('uploaded'))
      ) {
        return tbl;
      }
    }
    return null;
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  function parseVtopDate(str) {
    if (!str) return null;
    const clean = str.trim();
    const named = clean.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (named) {
      const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
      const m = months[named[2].toLowerCase()];
      if (m !== undefined) return new Date(+named[3], m, +named[1], 23, 59, 59);
    }
    const numeric = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (numeric) {
      const month = +numeric[2] - 1;
      if (month >= 0 && month <= 11) return new Date(+numeric[3], month, +numeric[1], 23, 59, 59);
    }
    return null;
  }

  function getDaysRemaining(dueDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    return Math.round((target - today) / 86400000);
  }

  function getAuthorizedId() {
    const badge = document.querySelector('.navbar-text.small.fw-bold, .VTopHeaderStyle, span.navbar-text');
    if (badge) {
      const m = badge.innerText.match(/([0-9]{2}[A-Za-z]{3}[0-9]{3,5})/);
      if (m) return m[1].toUpperCase();
    }
    const input = document.getElementById('authorizedID');
    if (input && input.value) return input.value.trim().toUpperCase();
    return '';
  }

  function getCsrfToken() {
    const el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── START ────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDaTracker);
  } else {
    initDaTracker();
  }
})();
