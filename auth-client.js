(function () {
  'use strict';
  const config = window.NAMECARD_CONFIG || {};
  let credential = '';
  let email = '';
  let expiresAt = 0;

  function decode(token) {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  }
  function getToken() {
    if (!credential || Date.now() >= expiresAt - 60000) {
      credential = ''; email = '';
      return '';
    }
    return credential;
  }
  function accept(response) {
    try {
      const claims = decode(response.credential);
      if (!claims.email || !claims.exp || claims.aud !== config.GOOGLE_CLIENT_ID) {
        throw new Error('登入憑證不屬於本網站。');
      }
      credential = response.credential;
      email = String(claims.email).toLowerCase();
      expiresAt = Number(claims.exp) * 1000;
      window.dispatchEvent(new Event('namecard:account-changed'));
    } catch (error) {
      console.error(error);
    }
  }
  async function renderButton() {
    for (let i = 0; i < 100 && !window.google?.accounts?.id; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!window.google?.accounts?.id) throw new Error('無法載入 Google 登入元件。');
    window.google.accounts.id.initialize({
      client_id: config.GOOGLE_CLIENT_ID,
      callback: accept,
      auto_select: false
    });
    const holder = document.getElementById('namecardSignIn');
    holder.replaceChildren();
    window.google.accounts.id.renderButton(holder, {
      theme: 'outline', size: 'large', text: 'signin_with', width: 260
    });
  }
  function signOut() {
    credential = ''; email = ''; expiresAt = 0;
    window.google?.accounts?.id?.disableAutoSelect();
    window.NamecardPeople?.clearAuthorization();
    window.dispatchEvent(new Event('namecard:account-changed'));
  }
  window.NamecardAuth = {getToken, getEmail: () => getToken() ? email : '',
    signOut, renderButton};
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderButton().catch(console.error));
  } else {
    renderButton().catch(console.error);
  }
})();
