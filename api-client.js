(function () {
  'use strict';
  const peopleMethods = new Set([
    'secureCheckDuplicateContacts',
    'secureCreateGoogleContactWithOptionalPhoto',
    'secureLoadExistingGoogleContact',
    'secureGetExistingGoogleContactPhotoInfo',
    'secureUpdateGoogleContactWithOptionalPhoto'
  ]);
  const usage = {startedAt: new Date().toISOString(), geminiRequests: 0,
    geminiUsageReports: 0, geminiInputTokens: 0, geminiOutputTokens: 0, geminiTotalTokens: 0};

  async function rpc(method, args) {
    if (peopleMethods.has(method)) return window.NamecardPeople[method](...args);
    const result = await window.NamecardGateway.invoke(method, args);
    if (method === 'secureRecognizeBusinessCard') {
      usage.geminiRequests++;
      if (result?.usage?.totalTokens != null) {
        usage.geminiUsageReports++;
        usage.geminiInputTokens += Number(result.usage.inputTokens || 0);
        usage.geminiOutputTokens += Number(result.usage.outputTokens || 0);
        usage.geminiTotalTokens += Number(result.usage.totalTokens || 0);
      }
    }
    if (method === 'getDebugUsageStatus') return {...result, usage: {...result.usage, ...usage}};
    return result;
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
