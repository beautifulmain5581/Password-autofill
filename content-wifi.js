// VIT Wi-Fi Resilient Content Script - AutoFill & Immediate AutoSubmit
// Optimized for slow / flaky campus captive portals

(function () {
  'use strict';

  if (window.__vit_wifi_loaded) return;
  window.__vit_wifi_loaded = true;

  let config = {
    wifiUsername: '',
    wifiPassword: '',
    autoSubmitWifi: true
  };

  chrome.storage.local.get({
    wifiUsername: '',
    wifiPassword: '',
    autoSubmitWifi: true
  }, (items) => {
    config = items;
    if (!config.wifiUsername || !config.wifiPassword) {
      console.log('VIT AutoFill: No Wi-Fi credentials saved. Please set them in extension settings.');
      return;
    }
    startWifiAutomation();
  });

  let submitted = false;

  function startWifiAutomation() {
    // 1. Initial attempt
    attemptWifiLogin();

    // 2. MutationObserver as DOM elements stream in
    const observer = new MutationObserver(() => {
      if (attemptWifiLogin()) {
        observer.disconnect();
      }
    });

    const root = document.documentElement || document.body;
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true
      });
    }

    // 3. Persistent polling interval (checks every 350ms for up to 3 minutes)
    // Ensures sluggish or slow captive portal redirects still succeed
    const poller = setInterval(() => {
      if (attemptWifiLogin()) {
        clearInterval(poller);
        observer.disconnect();
      }
    }, 350);

    setTimeout(() => {
      clearInterval(poller);
      observer.disconnect();
    }, 180000);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attemptWifiLogin);
    }
    window.addEventListener('load', attemptWifiLogin);
  }

  function attemptWifiLogin() {
    if (submitted) return true;

    // Check if already authenticated or on a logout screen
    const pageText = (document.body ? document.body.innerText : '').toLowerCase();
    const currentUrl = window.location.href.toLowerCase();

    if (pageText.includes('you are successfully logged in') ||
        pageText.includes('logout') ||
        pageText.includes('logged out') ||
        currentUrl.includes('authlogout')) {
      return true; // Already connected or logged out
    }

    // Locate Username Field (Pronto uses userId, other portals use username)
    const userField = document.querySelector(
      'input[name="userId"], input[name="username"], #userId, #username, input[type="text"]'
    );

    // Locate Password Field
    const passField = document.querySelector(
      'input[name="password"], #password, input[type="password"]'
    );

    // Locate Submit Button
    const submitBtn = document.querySelector(
      'input[name="Submit22"], input[type="submit"], button[type="submit"], input[value*="Login" i], button[value*="Login" i], #loginBtn'
    ) || Array.from(document.querySelectorAll('input[type="button"], button, a.btn')).find(el => {
      const val = (el.value || el.innerText || '').toLowerCase();
      return val.includes('login') || val.includes('sign in') || val.includes('submit');
    });

    if (userField && passField) {
      submitted = true;

      // Fill Credentials
      setInputValue(userField, config.wifiUsername);
      setInputValue(passField, config.wifiPassword);

      showToast('VIT Wi-Fi', 'Credentials filled! Logging in automatically...', 3000);

      // Auto-submit
      if (config.autoSubmitWifi !== false) {
        setTimeout(() => {
          if (submitBtn) {
            simulateClick(submitBtn);
          } else if (userField.form) {
            userField.form.submit();
          }
        }, 300);
      }

      return true;
    }

    return false;
  }

  function setInputValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function simulateClick(element) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.click();
  }

  function showToast(title, message, duration = 3000) {
    let toast = document.getElementById('vit-autofill-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vit-autofill-toast';
      document.body ? document.body.appendChild(toast) : document.documentElement.appendChild(toast);
    }

    toast.innerHTML = `
      <div class="vit-toast-header">
        <span class="vit-toast-badge">VIT Wi-Fi</span>
        <strong>${title}</strong>
      </div>
      <div class="vit-toast-body">${message}</div>
    `;

    toast.classList.add('vit-toast-show');
    clearTimeout(toast.__hideTimer);
    toast.__hideTimer = setTimeout(() => {
      toast.classList.remove('vit-toast-show');
    }, duration);
  }
})();
