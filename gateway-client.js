(function () {
  'use strict';
  const config = window.NAMECARD_CONFIG || {};
  let frame;
  let bridgeWindow;
  let ready = false;
  let serial = 0;
  const channel = crypto.randomUUID();
  let accountCache = null;
  const waiting = new Map();
  const trustedOrigin = /^https:\/\/(?:[a-z0-9-]+\.)*(?:[a-z0-9-]*script\.googleusercontent\.com|script\.google\.com)$/i;

  function iframe() {
    if (frame) return frame;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(config.APPS_SCRIPT_URL || '')) {
      throw new Error('尚未設定 Apps Script 網頁應用程式網址，請完成部署設定。');
    }
    frame = document.createElement('iframe');
    frame.src = config.APPS_SCRIPT_URL + '?channel=' + encodeURIComponent(channel);
    frame.title = 'NameCard API';
    frame.style.display = 'none';
    document.body.appendChild(frame);
    return frame;
  }
  window.addEventListener('message', event => {
    if (!frame || !trustedOrigin.test(event.origin)) return;
    const message = event.data || {};
    if (message.channel !== channel) return;
    if (message.type === 'namecard:ready') {
      if (ready && event.source !== bridgeWindow) return;
      bridgeWindow = event.source;
      ready = true;
      window.dispatchEvent(new Event('namecard:gateway-ready'));
    }
    if (message.type === 'namecard:result' && event.source === bridgeWindow && waiting.has(message.id)) {
      const item = waiting.get(message.id);
      waiting.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.result);
    }
  });

  async function invoke(method, args) {
    const token = window.NamecardAuth?.getToken();
    if (!token) {
      if (method === 'getCurrentUserAccessStatus') return {allowed: false, reason: 'LOGIN_REQUIRED', email: ''};
      throw new Error('請先選擇 Google 帳號登入。');
    }
    iframe();
    if (!ready) {
      await new Promise((resolve, reject) => {
        const onReady = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          window.removeEventListener('namecard:gateway-ready', onReady);
          reject(new Error('Apps Script 無法載入，請確認部署允許任何人存取。'));
        }, 15000);
        window.addEventListener('namecard:gateway-ready', onReady, {once: true});
      });
    }
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Apps Script 回應逾時，請稍後重試。'));
      }, 60000);
      waiting.set(id, {resolve, reject, timer});
      bridgeWindow.postMessage({type: 'namecard:rpc', channel, id, token, method, args}, '*');
    });
  }
  window.NamecardGateway = {invoke, currentAccount: async () => {
    const token = window.NamecardAuth?.getToken();
    if (accountCache && accountCache.token === token && Date.now() < accountCache.until) {
      return accountCache.email;
    }
    const status = await invoke('getCurrentUserAccessStatus', []);
    if (!status?.allowed) throw new Error('目前帳號沒有使用權限。');
    const email = String(status.email || '').toLowerCase();
    accountCache = {token, email, until: Date.now() + 5 * 60 * 1000};
    return email;
  }};
  window.addEventListener('namecard:account-changed', () => { accountCache = null; });
})();
