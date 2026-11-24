// IRCTC login helper - APK ke WebView me chalta hai. Password JS ko kabhi wapas nahi diya jata.
(function () {
  if (window.SarthiIrctc && window.SarthiIrctc.v === 3) return;

  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function findFields() {
    var u = document.querySelector('input[formcontrolname="userid"], input[placeholder*="User Name" i], input[placeholder*="User ID" i]');
    var p = document.querySelector('input[formcontrolname="pwd"], input[formcontrolname="password"], input[type="password"]');
    if (!u || !p) {
      var pws = document.querySelectorAll('input[type="password"]');
      var pw = null;
      for (var i = 0; i < pws.length; i++) {
        if (visible(pws[i])) { pw = pws[i]; break; }
      }
      if (pw) {
        p = pw;
        var scope = (pw.closest && pw.closest('form, app-login, .ui-dialog, .p-dialog, [role="dialog"]')) || document;
        var texts = scope.querySelectorAll('input[type="text"], input:not([type])');
        for (var j = 0; j < texts.length; j++) {
          if (visible(texts[j]) && !/captcha/i.test((texts[j].name || '') + ' ' + (texts[j].id || '') + ' ' + (texts[j].placeholder || ''))) {
            u = texts[j];
            break;
          }
        }
      }
    }
    return (u && p) ? { u: u, p: p } : null;
  }

  function setV(el, v) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    ['input', 'change'].forEach(function (n) {
      el.dispatchEvent(new Event(n, { bubbles: true }));
    });
  }

  window.SarthiIrctc = {
    v: 3,
    // none | ready | error | loggedin | sorry
    status: function () {
      try {
        var txt = (document.body && document.body.innerText) || '';
        if (/sorry!*\s*please try again/i.test(txt)) return 'sorry';
        var f = findFields();
        if (f && visible(f.u) && visible(f.p)) {
          return /incorrect user ?name or password|invalid user|account (is )?locked|invalid credentials/i.test(txt) ? 'error' : 'ready';
        }
        if (/\blogout\b|\bsign ?out\b/i.test(txt) || document.querySelector('a[href*="logout"], button[aria-label*="logout" i]')) {
          return 'loggedin';
        }
        return 'none';
      } catch (e) { return 'none'; }
    },
    openLogin: function () {
      try {
        if (findFields()) return 'already_open';
        var txt = (document.body && document.body.innerText) || '';
        if (/\blogout\b|\bsign ?out\b/i.test(txt) || document.querySelector('a[href*="logout"], button[aria-label*="logout" i]')) {
          return 'loggedin';
        }
        var loginSel = 'a.loginText, button.loginText, a[aria-label*="Click here to Login" i], a[aria-label*="Login" i], button[aria-label*="Login" i]';
        var candidates = Array.prototype.slice.call(document.querySelectorAll(loginSel + ', app-header a, app-header button, nav a, nav button, button, a'));
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (!visible(el)) continue;
          var t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          var cls = String(el.className || '');
          if (/loginText/i.test(cls) || /^(login|sign ?in)$/i.test(t)) {
            el.click();
            return 'clicked';
          }
        }
        var menuBtn = document.querySelector('app-header .h_menu_drop_button, a.h_menu_drop_button, button[aria-label*="menu" i], app-header i.fa-bars, app-header i.fa-align-justify, app-header .pull-right a, app-header .fa-user');
        if (menuBtn && visible(menuBtn)) {
          var clickTarget = (menuBtn.closest && menuBtn.closest('a, button')) || menuBtn;
          clickTarget.click();
          setTimeout(function () {
            var after = document.querySelectorAll('a.loginText, button.loginText, a, button');
            for (var j = 0; j < after.length; j++) {
              if (!visible(after[j])) continue;
              var t2 = (after[j].innerText || after[j].textContent || '').replace(/\s+/g, ' ').trim();
              if (/^(login|sign ?in)$/i.test(t2) || /loginText/i.test(String(after[j].className || ''))) {
                after[j].click();
                break;
              }
            }
          }, 350);
          return 'menu_opened';
        }
        return 'not_found';
      } catch (e) { return 'error'; }
    },
    fill: function (user, pass) {
      var f = findFields();
      if (!f || !user || !pass) return false;
      if (String(f.u.value || '').trim() || String(f.p.value || '').trim()) return false;
      setV(f.u, user);
      setV(f.p, pass);
      return true;
    },
    // SIGN IN dabane par user/pass sirf stage hota hai; save tab hota hai jab login SAFAL ho
    hook: function () {
      if (window.__sarthiIrctcHook) return;
      window.__sarthiIrctcHook = 1;
      function stageNow() {
        try {
          var f = findFields();
          if (f && f.u.value && f.p.value && window.SarthiCred) {
            window.SarthiCred.stage(f.u.value, f.p.value);
          }
        } catch (x) {}
      }
      document.addEventListener('click', function (e) {
        try {
          var b = e.target && e.target.closest && e.target.closest('button, input[type="submit"]');
          if (!b) return;
          var bt = (b.innerText || b.value || '').trim();
          if (!/sign\s*in|login/i.test(bt)) return;
          stageNow();
        } catch (x) {}
      }, true);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') stageNow();
      }, true);
    }
  };
})();

