// IRCTC login helper - APK ke WebView me chalta hai. Password JS ko kabhi wapas nahi diya jata.
(function () {
  if (window.SarthiIrctc && window.SarthiIrctc.v === 2) return;

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
    ['input', 'change', 'blur'].forEach(function (n) {
      el.dispatchEvent(new Event(n, { bubbles: true }));
    });
  }

  window.SarthiIrctc = {
    v: 2,
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

