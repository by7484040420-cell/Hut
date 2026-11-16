// IRCTC login helper (NEW file) - APK ke WebView me chalta hai. Password JS ko kabhi wapas nahi diya jata.
(function () {
  if (window.SarthiIrctc) return;

  function findFields() {
    var u = document.querySelector('input[formcontrolname="userid"]');
    var p = document.querySelector('input[formcontrolname="pwd"]');
    if (!u || !p) {
      var pw = document.querySelector('input[type="password"]');
      if (pw) {
        p = pw;
        u = (pw.closest('form') || document).querySelector('input[type="text"]');
      }
    }
    return (u && p) ? { u: u, p: p } : null;
  }

  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function setV(el, v) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    ['input', 'change', 'blur'].forEach(function (n) {
      el.dispatchEvent(new Event(n, { bubbles: true }));
    });
  }

  window.SarthiIrctc = {
    // none | ready | error | loggedin
    status: function () {
      try {
        var f = findFields();
        var txt = (document.body && document.body.innerText) || '';
        if (f && visible(f.u) && visible(f.p)) {
          return /incorrect user ?name or password|invalid user|account (is )?locked/i.test(txt) ? 'error' : 'ready';
        }
        if (/\blogout\b/i.test(txt)) return 'loggedin';
        return 'none';
      } catch (e) { return 'none'; }
    },
    fill: function (user, pass) {
      var f = findFields();
      if (!f) return false;
      setV(f.u, user);
      setV(f.p, pass);
      return true;
    },
    // SIGN IN dabane par user/pass sirf stage hota hai; save tab hota hai jab login SAFAL ho
    hook: function () {
      if (window.__sarthiIrctcHook) return;
      window.__sarthiIrctcHook = 1;
      document.addEventListener('click', function (e) {
        try {
          var b = e.target && e.target.closest && e.target.closest('button');
          if (!b || !/sign\s*in/i.test(b.innerText || '')) return;
          var f = findFields();
          if (f && f.u.value && f.p.value && window.SarthiCred) window.SarthiCred.stage(f.u.value, f.p.value);
        } catch (x) {}
      }, true);
    }
  };
})();
