(function () {
  'use strict';
  const cfg = window.NAMECARD_CONFIG || {};
  const base = String(cfg.API_BASE_URL || '').replace(/\/$/, '');

  async function rpc(method, args) {
    const response = await fetch(base + '/api/rpc', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({method, args})
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && method !== 'getCurrentUserAccessStatus') {
      window.location.href = base + '/auth/login';
      throw new Error('登入已失效，正在重新登入。');
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || ('HTTP ' + response.status));
    }
    return data.result;
  }

  function runner() {
    let success = function () {};
    let failure = function (e) { console.error(e); };
    const chain = new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { success = fn; return chain; };
        if (prop === 'withFailureHandler') return function (fn) { failure = fn; return chain; };
        return function () {
          const args = Array.prototype.slice.call(arguments);
          const method = String(prop);
          rpc(method, args).then(success).catch(failure).finally(function () {
            if (method !== 'getDebugUsageStatus') {
              window.dispatchEvent(new Event('namecard:rpc-complete'));
            }
          });
          return chain;
        };
      }
    });
    return chain;
  }

  window.google = window.google || {};
  Object.defineProperty(window.google, 'script', {
    configurable: true,
    value: { get run() { return runner(); } }
  });
})();
