// VTOP Examinations > Marks — Aggregate Calculator
// Injects a natural, left-aligned "Total" row into <tfoot> of each subject's marks table.
// Shows conducted max, conducted weightage, scored mark, weightage mark,
// and lost weightage marks in the Remark column.
// Numbers only, no percentages. No separate cards.

(function () {
  'use strict';

  if (window.__vit_vtop_marks_initialized) return;
  window.__vit_vtop_marks_initialized = true;

  // ─── SCAN LOGIC ───────────────────────────────────────────────────────────

  let scanThrottle = false;

  function scheduleScan() {
    if (scanThrottle) return;
    scanThrottle = true;
    setTimeout(function () {
      scanThrottle = false;
      doScan();
    }, 400);
  }

  function doScan() {
    // Fast gate: only run on pages with marks content
    var bodyText = document.body ? (document.body.innerText || '') : '';
    if (!bodyText.includes('Mark Title') && !bodyText.includes('Marks View')) return;

    // Remove any leftover summary cards from previous versions
    var strayCards = document.querySelectorAll('.vit-marks-summary-card, .vit-marks-summary-tr');
    for (var c = 0; c < strayCards.length; c++) {
      strayCards[c].remove();
    }

    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      if (isMarksSubTable(tables[i])) {
        processMarksTable(tables[i]);
      }
    }
  }

  // Periodic polling
  setInterval(doScan, 1500);

  // MutationObserver for immediate responsiveness
  (function setupObserver() {
    var root = document.getElementById('page-wrapper') ||
               document.getElementById('main-section') ||
               document.body;
    if (!root) {
      document.addEventListener('DOMContentLoaded', function () {
        var r = document.body;
        if (r) new MutationObserver(scheduleScan).observe(r, { childList: true, subtree: true });
      });
      return;
    }
    new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doScan);
  } else {
    doScan();
  }

  // ─── DETECTION ────────────────────────────────────────────────────────────

  function isMarksSubTable(tbl) {
    var hRow = tbl.querySelector('thead tr') ||
               tbl.querySelector('tr.tableHeader') ||
               tbl.querySelector('tr:first-child');
    if (!hRow) return false;

    var txt = (hRow.innerText || '').toLowerCase();
    return txt.includes('mark title') &&
           txt.includes('max') &&
           txt.includes('scored');
  }

  // ─── PROCESS TABLE ────────────────────────────────────────────────────────

  function processMarksTable(tbl) {
    var hRow = tbl.querySelector('thead tr') ||
               tbl.querySelector('tr.tableHeader') ||
               tbl.querySelector('tr:first-child');
    if (!hRow) return;

    var hCells = hRow.querySelectorAll('th, td');

    // Collect data rows (exclude header, tfoot, and injected rows)
    var allRows = tbl.querySelectorAll('tr');
    var dataRows = [];
    for (var i = 0; i < allRows.length; i++) {
      var tr = allRows[i];
      if (tr === hRow) continue;
      if (tr.classList.contains('vit-marks-aggregate-row')) continue;
      if (tr.closest('tfoot')) continue;
      var tds = tr.querySelectorAll('td');
      if (tds.length >= 4) dataRows.push(tr);
    }

    if (dataRows.length === 0) return;

    // Cache check
    var sig = '';
    for (var di = 0; di < dataRows.length; di++) sig += dataRows[di].innerText.trim() + '||';
    if (tbl.dataset.vitMarksSig === sig && tbl.querySelector('tfoot .vit-marks-aggregate-row')) return;

    // Map column indices
    var colSl = -1, colTitle = -1, colMax = -1, colWeightage = -1;
    var colStatus = -1, colScored = -1, colWeightageMark = -1, colRemark = -1;

    for (var ci = 0; ci < hCells.length; ci++) {
      var ct = (hCells[ci].innerText || '').trim().toLowerCase();
      if (colSl === -1 && (ct === 'sl.no.' || ct === 'sl.no' || ct === 'sl no')) { colSl = ci; }
      else if (colTitle === -1 && ct.includes('mark title')) { colTitle = ci; }
      else if (colMax === -1 && (ct.includes('max. mark') || ct.includes('max mark'))) { colMax = ci; }
      else if (colWeightage === -1 && ct.includes('weightage %')) { colWeightage = ci; }
      else if (colWeightage === -1 && ct.includes('weightage') && !ct.includes('mark')) { colWeightage = ci; }
      else if (colStatus === -1 && ct === 'status') { colStatus = ci; }
      else if (colScored === -1 && ct.includes('scored mark')) { colScored = ci; }
      else if (colScored === -1 && ct === 'scored') { colScored = ci; }
      else if (colWeightageMark === -1 && ct.includes('weightage mark')) { colWeightageMark = ci; }
      else if (colRemark === -1 && ct === 'remark') { colRemark = ci; }
    }

    if (colMax === -1 || colScored === -1) return;

    // Aggregate computation
    var conductedMax = 0, conductedWeightage = 0;
    var totalScored = 0, totalWeightageMark = 0;
    var validRows = 0, evaluatedRows = 0;

    for (var ri = 0; ri < dataRows.length; ri++) {
      var cells = dataRows[ri].querySelectorAll('td');
      var maxVal = parseFloat((cells[colMax] || {}).innerText) || 0;
      var weightVal = colWeightage !== -1 ? (parseFloat((cells[colWeightage] || {}).innerText) || 0) : 0;
      var statusTxt = colStatus !== -1 ? ((cells[colStatus] || {}).innerText || '').trim() : '';
      var scoredTxt = ((cells[colScored] || {}).innerText || '').trim();
      var wMarkTxt = colWeightageMark !== -1 ? ((cells[colWeightageMark] || {}).innerText || '').trim() : '';

      if (maxVal > 0 || weightVal > 0) {
        validRows++;
        var absent = /absent/i.test(statusTxt);
        var hasScored = scoredTxt && scoredTxt !== '-' && !isNaN(parseFloat(scoredTxt));
        var hasWMark = wMarkTxt && wMarkTxt !== '-' && !isNaN(parseFloat(wMarkTxt));

        if (hasScored || absent || hasWMark) {
          evaluatedRows++;
          conductedMax += maxVal;
          conductedWeightage += weightVal;
          if (!absent) {
            totalScored += parseFloat(scoredTxt) || 0;
            totalWeightageMark += parseFloat(wMarkTxt) || 0;
          }
        }
      }
    }

    // Lost marks in weightage
    var lostWeightage = Math.max(0, Math.round((conductedWeightage - totalWeightageMark) * 100) / 100);

    // ── Build natural table footer row ─────────────────────────────────────
    var tfoot = tbl.querySelector('tfoot');
    if (!tfoot) {
      tfoot = document.createElement('tfoot');
      tbl.appendChild(tfoot);
    }

    var aggRow = tfoot.querySelector('.vit-marks-aggregate-row');
    if (!aggRow) {
      aggRow = document.createElement('tr');
      aggRow.className = 'vit-marks-aggregate-row';
      tfoot.appendChild(aggRow);
    }

    aggRow.innerHTML = '';
    for (var ki = 0; ki < hCells.length; ki++) {
      var td = document.createElement('td');
      td.style.cssText = 'text-align:left;vertical-align:middle;padding:8px 10px;font-size:12.5px;';

      if (ki === colSl || (colSl === -1 && ki === 0)) {
        td.innerHTML = '<strong style="color:#337ab7;">\u03A3</strong>';
      } else if (ki === colTitle) {
        td.innerHTML = '<strong class="vit-marks-agg-label">Total</strong>';
      } else if (ki === colMax) {
        td.innerHTML = '<strong>' + (conductedMax > 0 ? fmt(conductedMax) : '\u2014') + '</strong>';
      } else if (ki === colWeightage) {
        td.innerHTML = '<strong>' + (conductedWeightage > 0 ? fmt(conductedWeightage) : '\u2014') + '</strong>';
      } else if (ki === colStatus) {
        td.innerHTML = '<span>' + evaluatedRows + '/' + validRows + '</span>';
      } else if (ki === colScored) {
        td.innerHTML = conductedMax > 0
          ? '<strong style="color:#15803d;">' + fmt(totalScored) + '</strong>'
          : '<span style="color:#94a3b8;">\u2014</span>';
      } else if (ki === colWeightageMark) {
        td.innerHTML = conductedWeightage > 0
          ? '<strong style="color:#1d4ed8;">' + fmt(totalWeightageMark) + '</strong>'
          : '<span style="color:#94a3b8;">\u2014</span>';
      } else if (ki === colRemark) {
        if (conductedWeightage > 0) {
          td.innerHTML = lostWeightage > 0
            ? '<strong style="color:#b91c1c;">Lost: ' + fmt(lostWeightage) + '</strong>'
            : '<strong style="color:#15803d;">Lost: 0</strong>';
        } else {
          td.innerHTML = '<span style="color:#94a3b8;">\u2014</span>';
        }
      } else {
        td.innerHTML = '<span style="color:#94a3b8;">\u2014</span>';
      }
      aggRow.appendChild(td);
    }

    // Clean up any cards in container
    var parentTd = tbl.closest('td');
    if (parentTd) {
      var stray = parentTd.querySelectorAll('.vit-marks-summary-card');
      for (var s = 0; s < stray.length; s++) stray[s].remove();
    }

    tbl.dataset.vitMarksSig = sig;
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  function fmt(num) {
    var r = Math.round(num * 100) / 100;
    return r.toString();
  }

})();
