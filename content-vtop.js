// VTOP Content Script - Tailored for VIT Vellore & VIT Campuses VTOP Portal
// Handles automatic Student selection, credential autofill, AI captcha solving,
// Google Invisible reCAPTCHA handling, manual user captcha fallbacks, and reliable login submission.

(function () {
  'use strict';

  if (window.__vit_vtop_initialized) return;
  window.__vit_vtop_initialized = true;

  let config = {
    vtopUsername: '',
    vtopPassword: '',
    autoSelectStudent: true,
    autoSolveCaptcha: true,
    autoSubmitVtop: true,
    autoFocusCaptcha: true,
    autoSubmitCaptcha6: true
  };

  chrome.storage.local.get({
    vtopUsername: '',
    vtopPassword: '',
    autoSelectStudent: true,
    autoSolveCaptcha: true,
    autoSubmitVtop: true,
    autoFocusCaptcha: true,
    autoSubmitCaptcha6: true
  }, (items) => {
    config = items;
    init();
  });

  // Listen for live setting changes from extension popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      for (const [key, change] of Object.entries(changes)) {
        config[key] = change.newValue;
      }
      execute();
    }
  });

  let landingFormSubmitted = false;
  let credentialsFilled = false;
  let loginSubmitted = false;
  let loginSubmittedTime = 0;
  let solvingInProgress = false;
  let lastSolvedCaptchaSrc = '';
  let captchaAttempts = 0;
  const MAX_CAPTCHA_ATTEMPTS = 3;

  let studentClickCount = 0;
  let lastStudentClickTime = 0;

  let googleRecaptchaTriggered = false;
  let recaptchaChallengeNotified = false;
  let caseBSubmitTimeout = null;

  let solverInstance = null;
  let solverLoadPromise = null;

  function getSolver() {
    if (!solverInstance) {
      const SolverClass = window.VtopCaptchaSolver || globalThis.VtopCaptchaSolver;
      if (!SolverClass) {
        console.error('[VTOP AutoFill] VtopCaptchaSolver class not found');
        return Promise.reject(new Error('VtopCaptchaSolver class not loaded'));
      }
      solverInstance = new SolverClass();
    }
    if (!solverLoadPromise) {
      solverLoadPromise = solverInstance.loadFromExtensionUrl('vtop_weights_int8.bin');
    }
    return solverLoadPromise.then(() => solverInstance);
  }

  function init() {
    // Preload neural network weights immediately in background
    getSolver().catch(err => console.warn('[VTOP AutoFill] Preload notice:', err));

    execute();

    // Observe DOM as it streams in
    const observer = new MutationObserver(() => {
      execute();
    });

    const root = document.documentElement || document.body;
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }

    // Monitor for 9-image Google reCAPTCHA challenge popup
    monitorRecaptchaChallenge();

    // Interval poller every 200ms to ensure actions fire even on slow/choppy networks
    const interval = setInterval(() => {
      execute();
    }, 200);

    // Stop poller after 10 minutes
    setTimeout(() => clearInterval(interval), 600000);

    // Track SPA URL changes (e.g. hash routing or pushState navigation)
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        landingFormSubmitted = false;
        credentialsFilled = false;
        loginSubmitted = false;
        loginSubmittedTime = 0;
        solvingInProgress = false;
        studentClickCount = 0;
        lastStudentClickTime = 0;
        execute();
      }
    }, 300);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', execute);
    }
    window.addEventListener('load', execute);
  }

  // Detect whether Google reCAPTCHA's interactive 9-image challenge popup is active on screen
  function isRecaptchaChallengeActive() {
    const iframes = document.querySelectorAll('iframe[src*="bframe"], iframe[title*="challenge"], iframe[src*="recaptcha"]');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || '';
      const title = iframe.getAttribute('title') || '';
      const isChallenge = src.includes('bframe') || /challenge/i.test(title);
      if (!isChallenge) continue;

      const rect = iframe.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 150) continue;
      if (rect.bottom <= 0 || rect.right <= 0) continue;
      if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) continue;
      if (rect.top < -50 || rect.left < -50) continue;

      let node = iframe;
      let hidden = false;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') {
          hidden = true;
          break;
        }
        const op = parseFloat(style.opacity || '1');
        if (!isNaN(op) && op < 0.1) {
          hidden = true;
          break;
        }
        node = node.parentElement;
      }

      if (!hidden) {
        return true;
      }
    }
    return false;
  }

  function monitorRecaptchaChallenge() {
    setInterval(() => {
      if (isRecaptchaChallengeActive()) {
        if (!recaptchaChallengeNotified) {
          recaptchaChallengeNotified = true;
          console.log('[VTOP AutoFill] 9-image Google reCAPTCHA challenge detected! Stopping auto-submit.');
          
          if (caseBSubmitTimeout) {
            clearTimeout(caseBSubmitTimeout);
            caseBSubmitTimeout = null;
          }

          showToast('VTOP Portal', 'Image CAPTCHA detected. Please solve the images to continue.', 6000);
        }
      } else {
        recaptchaChallengeNotified = false;
      }
    }, 250);
  }

  function execute() {
    // If the 9-image Google reCAPTCHA challenge is open, do not interfere
    if (isRecaptchaChallengeActive()) {
      return;
    }

    // 1. Check for Landing Page (Student Selection)
    if (config.autoSelectStudent && !landingFormSubmitted) {
      handleLandingPage();
    }

    // 2. Check for Login Form (Credentials Autofill, Captcha Solving, & Submission)
    handleLoginForm();
  }

  // --- 1. LANDING PAGE: SELECT STUDENT ---
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return (rect.width > 0 && rect.height > 0) || el.offsetParent !== null;
  }

  function findStudentElement() {
    // If password input exists on page, we are already on the login form, not landing page
    if (document.querySelector('input[type="password"], #password, #passwd')) {
      return null;
    }

    const stdForm = document.getElementById('stdForm');

    // 1. Check specific known classes, IDs, and attributes
    const selectors = [
      '#studentLoginBtn',
      '#stdBtn',
      '.cardStudent button',
      '.cardStudent a',
      '#cardStudent button',
      '#cardStudent a',
      '.cardStudent',
      '#cardStudent',
      '.btn.btn-primary.fw-bold',
      'button[onclick*="stud" i]',
      'a[onclick*="stud" i]',
      'a[href*="student" i]',
      'a[href*="stud" i]',
      '[data-role="student"]',
      '#student'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el)) {
        return { element: el, form: stdForm };
      }
    }

    // 2. Search card-like containers with heading "Student"
    const containers = document.querySelectorAll(
      '.card, [class*="card"], .col, .col-md-3, .col-sm-6, .portal-card, section > div, .box'
    );
    for (const card of containers) {
      if (!isElementVisible(card)) continue;
      const heading = card.querySelector('h1, h2, h3, h4, h5, h6, strong, b, span, p, .title');
      if (heading && /^\s*student(\s+login)?\s*$/i.test(heading.textContent)) {
        const btn = card.querySelector('button, a, input[type="submit"], input[type="button"]');
        return { element: btn || card, form: stdForm };
      }
    }

    // 3. Exact text match on clickables
    const clickables = Array.from(
      document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')
    );
    for (const el of clickables) {
      if (!isElementVisible(el)) continue;
      const text = (el.textContent || el.value || '').trim();
      if (/^\s*student(\s+login)?\s*$/i.test(text)) {
        return { element: el, form: stdForm };
      }
    }

    // 4. Looser match: clickable containing "student" without "parent", "employee", "alumni"
    for (const el of clickables) {
      if (!isElementVisible(el)) continue;
      const text = (el.textContent || el.value || '').trim().toLowerCase();
      if (text.includes('student') && !text.includes('parent') && !text.includes('employee') && !text.includes('alumni')) {
        return { element: el, form: stdForm };
      }
    }

    // 5. If stdForm exists
    if (stdForm) {
      const btn = stdForm.querySelector('button, a, input[type="submit"], input[type="button"]');
      return { element: btn || stdForm, form: stdForm };
    }

    return null;
  }

  function handleLandingPage() {
    if (document.querySelector('input[type="password"], #password, #passwd')) {
      landingFormSubmitted = true;
      return;
    }

    // Debounce student clicks: at least 1200ms apart, max 6 attempts
    if (Date.now() - lastStudentClickTime < 1200 || studentClickCount >= 6) {
      return;
    }

    const target = findStudentElement();
    if (!target) return;

    studentClickCount++;
    lastStudentClickTime = Date.now();
    landingFormSubmitted = true;

    showToast('VTOP Portal', 'Opening Student Login...', 2500);

    const { element, form } = target;

    // Visual highlight on chosen element
    try {
      element.style.outline = '3px solid #2563eb';
      element.style.boxShadow = '0 0 16px rgba(37, 99, 235, 0.6)';
    } catch (e) {}

    // 1. Synthetic mouse events + click
    try {
      element.focus();
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof element.click === 'function') {
        element.click();
      }
    } catch (err) {
      console.warn('[VTOP AutoFill] Error clicking student element:', err);
    }

    // 2. Injected page-context script: run openPage('std') or submit #stdForm
    try {
      const s = document.createElement('script');
      s.textContent = `
        (function() {
          try {
            if (typeof openPage === 'function') {
              try { openPage('std'); } catch(e) {}
              try { openPage('student'); } catch(e) {}
            }
            var f = document.getElementById('stdForm');
            if (f && !document.querySelector('input[type="password"]')) {
              try { HTMLFormElement.prototype.submit.call(f); } catch(err) { f.submit(); }
            }
          } catch(e) {}
        })();
      `;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}

    // 3. Fallback form submit after 250ms if page did not navigate
    if (form && form.tagName === 'FORM') {
      setTimeout(() => {
        if (!document.querySelector('input[type="password"], #password, #passwd')) {
          console.log('[VTOP AutoFill] Submitting #stdForm directly as fallback...');
          try {
            HTMLFormElement.prototype.submit.call(form);
          } catch (e) {
            try { form.submit(); } catch (err) {}
          }
        }
      }, 250);
    }

    // Allow retry after 1.5 seconds if we are still on the landing page
    setTimeout(() => {
      if (!document.querySelector('input[type="password"], #password, #passwd')) {
        landingFormSubmitted = false;
      }
    }, 1500);
  }

  // --- 2. LOGIN FORM HELPERS ---
  function getLoginForm() {
    return document.getElementById('vtopLoginForm') ||
           document.querySelector('form[name="vtopLoginForm"]') ||
           document.querySelector('input[type="password"]')?.closest('form') ||
           document.querySelector('#password, #passwd')?.closest('form') ||
           document.querySelector('form');
  }

  // Ensure #gResponse exists in DOM so VTOP's callBuiltValidation() does not crash on null.value
  function ensureGResponseElement(form) {
    let gr = document.getElementById('gResponse');
    if (!gr) {
      gr = document.createElement('input');
      gr.type = 'hidden';
      gr.id = 'gResponse';
      gr.name = 'gResponse';
      (form || getLoginForm() || document.body).appendChild(gr);
    }
    const gRecaptcha = document.getElementById('g-recaptcha-response');
    if (gRecaptcha && gRecaptcha.value) {
      gr.value = gRecaptcha.value;
    }
    return gr;
  }

  // --- 3. LOGIN FORM: FILL CREDENTIALS, SOLVE CAPTCHA, & AUTO-SUBMIT ---
  function handleLoginForm() {
    const userField = document.getElementById('username') || 
                      document.getElementById('uname') || 
                      document.querySelector('input[name="username"], input[name="uname"], input#username, input#uname, input[placeholder*="Register" i], input[placeholder*="Username" i], input[placeholder*="User ID" i]');

    const passField = document.getElementById('password') || 
                      document.getElementById('passwd') || 
                      document.querySelector('input[type="password"], input#password, input#passwd, input[name="password"], input[name="passwd"]');

    if (!userField || !passField) return;

    // Once login fields exist, we know we are past the landing page
    landingFormSubmitted = true;

    const form = getLoginForm();
    if (form) {
      ensureGResponseElement(form);
    }

    // Check if the page displays an error from a previous attempt
    const pageText = (document.body ? document.body.innerText : '');
    if (/invalid credentials|invalid user id|wrong password/i.test(pageText)) {
      showToast('VTOP Portal', 'Invalid Credentials! Please update in extension settings.', 6000);
      return;
    }

    const hasInvalidCaptchaError = /invalid captcha/i.test(pageText);

    // 1. Fill Username (Uppercase as required by VTOP)
    if (config.vtopUsername && userField.value.trim().toUpperCase() !== config.vtopUsername.toUpperCase()) {
      setFieldValue(userField, config.vtopUsername.toUpperCase());
    }

    // 2. Fill Password
    if (config.vtopPassword && !passField.value) {
      setFieldValue(passField, config.vtopPassword);
    }

    // Check for CAPTCHA elements
    const captchaField = document.getElementById('captchaStr') || 
                         document.getElementById('captchaCheck') || 
                         document.querySelector('input[name="captchaStr"], input[name="captchaCheck"], input[name="captcha"], input#captchaString, input[placeholder*="CAPTCHA" i]');

    const captchaImg = document.querySelector('#captchaBlock img') ||
                       document.querySelector('#imgCaptcha') ||
                       document.querySelector('img.form-control.img-fluid') ||
                       document.querySelector('img[src^="data:image"]') ||
                       document.querySelector('img[aria-describedby="button-addon2"]') ||
                       document.querySelector('#captcha_id') ||
                       document.querySelector('img[src*="captcha" i]');

    // Attach Enter key handler to password field
    setupPasswordListener(passField, captchaField);

    // If captcha image changed (e.g. new captcha fetched or refreshed), reset attempt locks
    if (captchaImg && captchaImg.src && captchaImg.src !== lastSolvedCaptchaSrc && lastSolvedCaptchaSrc !== '') {
      loginSubmitted = false;
      loginSubmittedTime = 0;
      credentialsFilled = false;
      solvingInProgress = false;
    }

    // Also monitor Google reCAPTCHA response fields in case user solves an interactive 9-image grid
    setupGoogleRecaptchaObserver();

    // === CASE A: Built-in 6-character Captcha is present ===
    if (captchaField && captchaImg) {
      // Setup manual input / Enter listener (for when user types captcha themselves)
      setupCaptchaSubmit(captchaField);

      // If AI auto-solve is enabled
      if (config.autoSolveCaptcha !== false && captchaImg.src) {
        if (captchaImg.src.startsWith('data:image') && captchaImg.src.length > 100) {
          if (captchaImg.src !== lastSolvedCaptchaSrc && !solvingInProgress && (Date.now() - loginSubmittedTime > 2500)) {
            if (captchaAttempts >= MAX_CAPTCHA_ATTEMPTS) {
              if (config.autoFocusCaptcha) captchaField.focus();
              showToast('VTOP Portal', 'Multiple attempts made. Please type the captcha manually.', 5000);
              return;
            }

            processCaptcha(captchaImg, captchaField);
          }
        }
      } else if (!config.autoSolveCaptcha && config.autoFocusCaptcha) {
        captchaField.focus();
        captchaField.classList.add('vit-autofill-highlight');
      }
    } 
    // === CASE B: No Captcha Shown on page / Google Invisible reCAPTCHA ===
    else if (!captchaField && !captchaImg) {
      const submitBtn = getMainSubmitButton();
      const hasCreds = Boolean(userField.value.trim() && passField.value);
      if (!hasCreds || !submitBtn) return;

      if (hasInvalidCaptchaError) {
        console.log('[VTOP AutoFill] Page shows "Invalid Captcha" in reCAPTCHA mode. Halting auto-loop.');
        showToast('VTOP Portal', 'Captcha failed. Please complete the captcha manually.', 6000);
        return;
      }

      if (isRecaptchaChallengeActive()) {
        return;
      }

      if (!credentialsFilled && !googleRecaptchaTriggered) {
        credentialsFilled = true;
        googleRecaptchaTriggered = true;
        showToast('VTOP Portal', 'Credentials filled! Logging in...', 2500);

        if (config.autoSubmitVtop !== false) {
          caseBSubmitTimeout = setTimeout(() => {
            const lateCaptcha = document.getElementById('captchaStr') || document.querySelector('#captchaBlock img');
            if (!lateCaptcha && !isRecaptchaChallengeActive()) {
              triggerLoginSubmit();
            }
          }, 350);
        }
      }
    }
  }

  // --- AI SOLVER FOR BUILT-IN TEXT CAPTCHAS ---
  async function processCaptcha(captchaImg, captchaField) {
    if (solvingInProgress) return;
    solvingInProgress = true;
    captchaAttempts++;
    lastSolvedCaptchaSrc = captchaImg.src;

    showToast('VTOP Portal', 'Credentials filled! Solving captcha...', 3000);

    try {
      const solver = await getSolver();
      const pixels = await solver.extractImagePixels(captchaImg);
      const solvedText = solver.predictGrayscale(pixels);

      solvingInProgress = false;

      if (solvedText && solvedText.length === 6) {
        console.log('[VTOP AutoFill] Captcha solved:', solvedText);
        setFieldValue(captchaField, solvedText);
        captchaField.classList.add('vit-autofill-highlight');

        showToast('VTOP Portal', `Captcha solved (${solvedText})! Clicking Submit...`, 2500);

        if (config.autoSubmitVtop !== false) {
          setTimeout(() => {
            triggerLoginSubmit();
          }, 150);
        }
      } else {
        console.warn('[VTOP AutoFill] Solver returned non-6-character result:', solvedText);
        if (config.autoFocusCaptcha) {
          captchaField.focus();
          captchaField.classList.add('vit-autofill-highlight');
        }
        showToast('VTOP Portal', 'Please type the 6-character captcha.', 4000);
      }
    } catch (err) {
      console.error('[VTOP AutoFill] Captcha solving error:', err);
      solvingInProgress = false;
      if (config.autoFocusCaptcha) {
        captchaField.focus();
        captchaField.classList.add('vit-autofill-highlight');
      }
    }
  }

  // --- PASSWORD FIELD ENTER KEY LISTENER ---
  function setupPasswordListener(passField, captchaField) {
    if (!passField || passField.__vit_listener_attached) return;
    passField.__vit_listener_attached = true;

    passField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cVal = (captchaField ? captchaField.value : '').trim();
        if (cVal.length === 6) {
          e.preventDefault();
          loginSubmittedTime = 0; // force submission
          triggerLoginSubmit();
        } else if (captchaField) {
          e.preventDefault();
          captchaField.focus();
        }
      }
    });
  }

  // --- FALLBACK: USER TYPES CAPTCHA THEMSELVES ---
  function setupCaptchaSubmit(captchaField) {
    if (!captchaField || captchaField.__vit_listener_attached) return;
    captchaField.__vit_listener_attached = true;

    const onCaptchaInput = () => {
      const val = (captchaField.value || '').trim();
      if (val.length === 6) {
        if (config.autoSubmitVtop !== false || config.autoSubmitCaptcha6 !== false) {
          showToast('VTOP Portal', '6 characters entered! Clicking Submit...', 2000);
          setTimeout(() => {
            triggerLoginSubmit();
          }, 80);
        }
      }
    };

    captchaField.addEventListener('input', onCaptchaInput);
    captchaField.addEventListener('keyup', onCaptchaInput);
    captchaField.addEventListener('change', onCaptchaInput);
    captchaField.addEventListener('paste', () => setTimeout(onCaptchaInput, 50));

    // Enter key inside captcha field triggers main submit immediately
    captchaField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loginSubmittedTime = 0; // force allow submit
        triggerLoginSubmit();
      }
    });

    // Also poll captcha field value every 250ms in case another tool filled it
    setInterval(() => {
      const val = (captchaField.value || '').trim();
      if (val.length === 6 && !solvingInProgress && Date.now() - loginSubmittedTime > 2500) {
        onCaptchaInput();
      }
    }, 250);
  }

  // --- GOOGLE RECAPTCHA OBSERVER (e.g. 9-Image Grid solved by user) ---
  function setupGoogleRecaptchaObserver() {
    if (window.__vit_recaptcha_observer_attached) return;
    window.__vit_recaptcha_observer_attached = true;

    const checkInterval = setInterval(() => {
      if (loginSubmitted && Date.now() - loginSubmittedTime < 3000) {
        return;
      }

      const gResponse = document.getElementById('gResponse');
      const gRecaptchaResponse = document.getElementById('g-recaptcha-response') ||
                                 document.querySelector('textarea[name="g-recaptcha-response"]');

      const token = (gResponse && gResponse.value) || (gRecaptchaResponse && gRecaptchaResponse.value);
      if (token && token.trim().length > 20) {
        console.log('[VTOP AutoFill] Google reCAPTCHA token verified! Submitting main form...');
        showToast('VTOP Portal', 'reCAPTCHA verified! Submitting...', 2500);
        clearInterval(checkInterval);

        if (gResponse) gResponse.value = token.trim();
        ensureGResponseElement(getLoginForm());

        submitAfterRecaptchaVerified();
      }
    }, 250);

    setTimeout(() => clearInterval(checkInterval), 300000);
  }

  function submitAfterRecaptchaVerified() {
    loginSubmitted = true;
    loginSubmittedTime = Date.now();
    const form = getLoginForm();

    showToast('VTOP Portal', 'reCAPTCHA verified! Submitting...', 2500);

    try {
      const s = document.createElement('script');
      s.textContent = `
        (function() {
          try {
            var f = document.getElementById('vtopLoginForm') || 
                    document.querySelector('form[name="vtopLoginForm"]') || 
                    document.querySelector('input[type="password"]')?.closest('form') || 
                    document.querySelector('form');
            var gr = document.getElementById('gResponse');
            var gval = document.getElementById('g-recaptcha-response');
            if (gr && gval && gval.value) gr.value = gval.value;
            if (typeof callBuiltValidation === 'function') {
              callBuiltValidation();
            } else if (f) {
              HTMLFormElement.prototype.submit.call(f);
            }
          } catch(e) {
            var f2 = document.getElementById('vtopLoginForm') || document.querySelector('form');
            if (f2) {
              try { HTMLFormElement.prototype.submit.call(f2); } catch(err) { f2.submit(); }
            }
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}

    if (form) {
      setTimeout(() => {
        try {
          HTMLFormElement.prototype.submit.call(form);
        } catch (e) {
          try { form.submit(); } catch (err) {}
        }
      }, 250);
    }
  }

  // --- TARGET THE MAIN SUBMIT BUTTON ---
  function isUsableSubmitButton(b) {
    if (!b) return false;
    if (b.id === 'button-addon2' || b.id === 'basic-addon2' || b.id === 'passwordIcon') return false;
    if (b.getAttribute('aria-describedby') === 'button-addon2') return false;
    if (b.querySelector('#passwordIcon, .fa-eye, .fa-eye-slash, .fa-sync, .fa-arrows-rotate, .fa-refresh')) return false;
    if (b.classList.contains('btn-light') || b.classList.contains('btn-close')) return false;
    const title = (b.getAttribute('title') || '').toLowerCase();
    if (title.includes('refresh') || title.includes('captcha') || title.includes('password')) return false;
    const text = (b.textContent || b.value || '').trim().toLowerCase();
    if (text.includes('refresh') || text.includes('toggle') || text.includes('show password')) return false;
    return true;
  }

  function getMainSubmitButton() {
    const form = getLoginForm() || document;

    // 1. Check direct high-confidence IDs
    const directIds = ['submitBtn', 'loginBtn', 'loginButton', 'submit_btn', 'captcha'];
    for (const id of directIds) {
      const el = document.getElementById(id);
      if (el && isUsableSubmitButton(el)) return el;
    }

    // 2. Search inside form and document
    const buttons = Array.from(
      form.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, [role="button"]')
    );

    const submitBtn = buttons.find(b => {
      if (!isUsableSubmitButton(b)) return false;

      const text = (b.textContent || b.value || '').trim().toLowerCase();
      const onclick = (b.getAttribute('onclick') || '').toLowerCase();
      const type = (b.getAttribute('type') || '').toLowerCase();
      const id = (b.id || '').toLowerCase();
      const name = (b.getAttribute('name') || '').toLowerCase();

      if (id === 'submitbtn' || id === 'loginbtn' || id === 'loginbutton') return true;
      if (name === 'submitbtn' || name === 'submit') return true;
      if (/^(submit|sign in|log in|login)$/i.test(text)) return true;
      if (text.includes('submit') || text.includes('log in') || text.includes('sign in')) return true;
      if (onclick.includes('builtvalidation') || onclick.includes('googlevalidation') || onclick.includes('validation') || onclick.includes('dologin')) return true;
      if (type === 'submit') return true;
      if (b.classList.contains('btn-primary') || b.classList.contains('btn-signIn') || b.classList.contains('btn-sm')) return true;

      return false;
    });

    if (submitBtn) return submitBtn;

    // Fallback: primary button inside form
    return form.querySelector('button.btn-primary, button[type="submit"], input[type="submit"], button.btn-sm, button.float-end');
  }

  // --- SUBMIT LOGIN FORM TO ENTER VTOP ---
  function triggerLoginSubmit() {
    // Debounce duplicate submissions within 2 seconds
    if (Date.now() - loginSubmittedTime < 2000) {
      return;
    }

    // If the 9-image Google challenge is active, wait for user
    if (isRecaptchaChallengeActive()) {
      console.log('[VTOP AutoFill] triggerLoginSubmit blocked because 9-image challenge is active');
      return;
    }

    const form = getLoginForm();

    const captchaField = document.getElementById('captchaStr') || 
                         document.getElementById('captchaCheck') || 
                         document.querySelector('input[name="captchaStr"], input[name="captchaCheck"], input[name="captcha"], input#captchaString, input[placeholder*="CAPTCHA" i]');
    
    const isBuiltInCaptcha = Boolean(captchaField);

    // CRITICAL SAFETY CHECK: If built-in text captcha exists, require all 6 characters!
    if (isBuiltInCaptcha) {
      const captchaVal = (captchaField ? captchaField.value : '').trim();
      if (captchaVal.length !== 6) {
        console.log('[VTOP AutoFill] Waiting for 6-character captcha before submitting (current length:', captchaVal.length, ')');
        return;
      }
    }

    const submitBtn = getMainSubmitButton();

    loginSubmittedTime = Date.now();
    loginSubmitted = true;

    if (isBuiltInCaptcha) {
      executeSubmission(submitBtn, form);
    } else {
      executeNoCaptchaSubmission(submitBtn, form);
    }
  }

  // Submission when NO 6-character text captcha is present (Invisible reCAPTCHA or direct login)
  function executeNoCaptchaSubmission(submitBtn, form) {
    if (isRecaptchaChallengeActive()) return;

    const targetForm = form || getLoginForm();
    ensureGResponseElement(targetForm);

    showToast('VTOP Portal', 'Logging in...', 2500);

    // Injected page script
    try {
      const s = document.createElement('script');
      s.textContent = `
        (function() {
          try {
            var f = document.getElementById('vtopLoginForm') || 
                    document.querySelector('form[name="vtopLoginForm"]') || 
                    document.querySelector('input[type="password"]')?.closest('form') || 
                    document.querySelector('form');
            var gr = document.getElementById('gResponse');
            var gval = document.getElementById('g-recaptcha-response');
            if (gr && gval && gval.value) gr.value = gval.value;

            if (typeof callGoogleValidation === 'function') {
              console.log('[VTOP Page Script] Invoking callGoogleValidation()');
              callGoogleValidation();
              return;
            }

            var btn = document.getElementById('submitBtn') || 
                      document.getElementById('loginBtn') ||
                      (f ? f.querySelector('button[type="submit"], button.btn-primary, button') : null);

            if (btn && typeof btn.onclick === 'function') {
              btn.onclick();
              return;
            }

            if (btn) {
              btn.click();
              return;
            }

            if (f) {
              HTMLFormElement.prototype.submit.call(f);
            }
          } catch(e) {
            var f2 = document.getElementById('vtopLoginForm') || document.querySelector('form');
            if (f2) {
              try { HTMLFormElement.prototype.submit.call(f2); } catch(err) { f2.submit(); }
            }
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}

    // Direct click
    if (submitBtn) {
      try {
        submitBtn.focus();
        submitBtn.classList.add('active');
        submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (typeof submitBtn.click === 'function') {
          submitBtn.click();
        }
      } catch (err) {}
    }

    setTimeout(() => {
      const activePass = document.querySelector('input[type="password"], #password, #passwd');
      if (activePass) {
        const activeForm = targetForm || getLoginForm();
        if (activeForm) {
          try {
            HTMLFormElement.prototype.submit.call(activeForm);
          } catch (err) {
            try { activeForm.submit(); } catch (e) {}
          }
        }
      }
    }, 350);

    setTimeout(() => {
      if (document.querySelector('input[type="password"], #password, #passwd')) {
        loginSubmitted = false;
      }
    }, 2500);
  }

  // Submission for Built-in 6-character text CAPTCHA
  function executeSubmission(submitBtn, form) {
    showToast('VTOP Portal', 'Logging in...', 2500);

    const targetForm = form || getLoginForm();
    ensureGResponseElement(targetForm);

    console.log('[VTOP AutoFill] Executing submission. submitBtn:', submitBtn, 'form:', targetForm);

    // 1. Script injection: Run in page context to execute page functions (callBuiltValidation, etc.)
    try {
      const s = document.createElement('script');
      s.textContent = `
        (function() {
          try {
            var f = document.getElementById('vtopLoginForm') || 
                    document.querySelector('form[name="vtopLoginForm"]') || 
                    document.querySelector('input[type="password"]')?.closest('form') || 
                    document.querySelector('form');
            var gr = document.getElementById('gResponse');
            var gval = document.getElementById('g-recaptcha-response');
            if (gr && gval && gval.value) gr.value = gval.value;

            // Direct page function call if defined by VTOP
            if (typeof callBuiltValidation === 'function') {
              console.log('[VTOP Page Script] Invoking callBuiltValidation()');
              callBuiltValidation();
              return;
            }

            var btn = document.getElementById('submitBtn') || 
                      document.getElementById('loginBtn') ||
                      (f ? f.querySelector('button[type="submit"], button.btn-primary, button') : null);

            if (btn && typeof btn.onclick === 'function') {
              console.log('[VTOP Page Script] Invoking btn.onclick()');
              btn.onclick();
              return;
            }

            if (btn) {
              console.log('[VTOP Page Script] Calling btn.click() in page context');
              btn.click();
              return;
            }

            if (f) {
              console.log('[VTOP Page Script] Submitting form via prototype');
              HTMLFormElement.prototype.submit.call(f);
            }
          } catch(e) {
            console.warn('[VTOP Page Script Error]', e);
            var f2 = document.getElementById('vtopLoginForm') || document.querySelector('form');
            if (f2) {
              try { HTMLFormElement.prototype.submit.call(f2); } catch(err) { f2.submit(); }
            }
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.warn('[VTOP AutoFill] Script injection error:', e);
    }

    // 2. Dispatch synthetic click events on submit button in content script context
    if (submitBtn) {
      try {
        submitBtn.focus();
        submitBtn.classList.add('active');
        submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (typeof submitBtn.click === 'function') {
          submitBtn.click();
        }
      } catch (err) {
        console.warn('[VTOP AutoFill] Content script click error:', err);
      }
    }

    // 3. Guaranteed fallback after 300ms if page did not navigate/unload
    setTimeout(() => {
      const activePass = document.querySelector('input[type="password"], #password, #passwd');
      if (activePass) {
        const activeForm = targetForm || getLoginForm();
        if (activeForm) {
          console.log('[VTOP AutoFill] Fallback native submit executing...');
          try {
            HTMLFormElement.prototype.submit.call(activeForm);
          } catch (err) {
            try { activeForm.submit(); } catch (e2) {}
          }
        }
      }
    }, 300);

    // 4. Release lock after 2.5s if still on login page to allow retry or Enter key
    setTimeout(() => {
      if (document.querySelector('input[type="password"], #password, #passwd')) {
        loginSubmitted = false;
      }
    }, 2500);
  }

  // --- HELPERS ---
  function setFieldValue(field, value) {
    if (!field) return;
    try {
      const proto = window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(field, value);
      } else {
        field.value = value;
      }
    } catch (e) {
      field.value = value;
    }
    field.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    field.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  function showToast(title, message, duration = 3000) {
    let toast = document.getElementById('vit-autofill-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vit-autofill-toast';
      (document.body || document.documentElement).appendChild(toast);
    }

    toast.innerHTML = `
      <div class="vit-toast-header">
        <span class="vit-toast-badge">VTOP</span>
        <strong>${title}</strong>
      </div>
      <div class="vit-toast-body">${message}</div>
    `;

    toast.classList.add('vit-toast-show');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.classList.remove('vit-toast-show');
    }, duration);
  }
})();
