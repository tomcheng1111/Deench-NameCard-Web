(function () {
  'use strict';

  const config = window.NAMECARD_CONFIG || {};
  const base = 'https://people.googleapis.com/v1/';
  const scope = 'https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/userinfo.email';
  const personFields = 'names,organizations,phoneNumbers,emailAddresses,addresses,urls,biographies,photos,metadata';
  let token = null;
  let tokenExpiresAt = 0;
  let tokenEmail = '';
  let tokenClient;
  let peopleRequests = 0;

  async function account() {
    return window.NamecardGateway.currentAccount();
  }

  async function gis() {
    for (let i = 0; i < 100; i++) {
      if (window.google?.accounts?.oauth2) return window.google.accounts.oauth2;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('無法載入 Google 授權程式，請檢查網路連線。');
  }

  async function accessToken() {
    const expectedEmail = await account();
    if (token && Date.now() < tokenExpiresAt && tokenEmail === expectedEmail) return token;
    const oauth2 = await gis();
    tokenClient ||= oauth2.initTokenClient({
      client_id: config.GOOGLE_CLIENT_ID,
      scope,
      callback: function () {}
    });
    const result = await new Promise((resolve, reject) => {
      tokenClient.callback = response => {
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      };
      tokenClient.error_callback = () => reject(new Error('Google 聯絡人授權視窗已關閉或無法開啟。'));
      tokenClient.requestAccessToken({login_hint: expectedEmail, prompt: ''});
    });
    const infoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {Authorization: 'Bearer ' + result.access_token}
    });
    if (!infoResponse.ok) throw new Error('無法確認 Google 聯絡人授權帳號。');
    const info = await infoResponse.json();
    if (String(info.email || '').toLowerCase() !== expectedEmail) {
      oauth2.revoke(result.access_token, () => {});
      throw new Error('聯絡人授權帳號與目前登入帳號不同，請選擇 ' + expectedEmail + '。');
    }
    token = result.access_token;
    tokenEmail = expectedEmail;
    tokenExpiresAt = Date.now() + Math.max(0, Number(result.expires_in || 3600) - 90) * 1000;
    return token;
  }

  async function request(path, options = {}) {
    const access = await accessToken();
    peopleRequests++;
    const response = await fetch(base + path, {
      method: options.method || 'GET',
      headers: {Authorization: 'Bearer ' + access, ...(options.body ? {'Content-Type': 'application/json'} : {})},
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) { token = null; tokenExpiresAt = 0; }
      throw new Error(error.error?.message || 'Google 聯絡人 API HTTP ' + response.status);
    }
    return response.json();
  }

  const arr = value => Array.isArray(value) ? value : [];
  function personFromContact(contact) {
    const n = contact?.name || {}, o = contact?.organization || {};
    const p = {};
    if (n.displayName || n.givenName || n.familyName) {
      p.names = [{displayName: n.displayName || undefined, givenName: n.givenName || undefined, familyName: n.familyName || undefined}];
    }
    if (o.name || o.department || o.title) {
      p.organizations = [{name: o.name || '', department: o.department || '', title: o.title || '', type: 'work'}];
    }
    p.phoneNumbers = arr(contact.phones).filter(x => x?.value).map(x => ({value: x.value, type: x.type || 'work'}));
    p.emailAddresses = arr(contact.emails).filter(x => x?.value).map(x => ({value: x.value, type: x.type || 'work'}));
    p.addresses = arr(contact.addresses).filter(x => x?.formattedValue || x?.value).map(x => ({formattedValue: x.formattedValue || x.value, type: x.type || 'work'}));
    p.urls = arr(contact.websites).filter(x => x?.value || x?.url).map(x => ({value: x.value || x.url, type: x.type || 'work'}));
    if (contact.finalBiography) p.biographies = [{value: contact.finalBiography, contentType: 'TEXT_PLAIN'}];
    return p;
  }

  function contactFromPerson(p) {
    const n = p.names?.[0] || {}, o = p.organizations?.[0] || {};
    return {
      resourceName: p.resourceName, etag: p.etag,
      name: {displayName: n.displayName || '', givenName: n.givenName || '', familyName: n.familyName || ''},
      organization: {name: o.name || '', department: o.department || '', title: o.title || ''},
      phones: arr(p.phoneNumbers).map(x => ({value: x.value || '', type: x.type || ''})),
      emails: arr(p.emailAddresses).map(x => ({value: x.value || '', type: x.type || ''})),
      addresses: arr(p.addresses).map(x => ({formattedValue: x.formattedValue || '', type: x.type || ''})),
      websites: arr(p.urls).map(x => ({value: x.value || '', type: x.type || ''})),
      biography: p.biographies?.[0]?.value || ''
    };
  }

  function comparableName(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  }
  function comparablePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('00886')) digits = digits.slice(2);
    if (digits.startsWith('886')) digits = '0' + digits.slice(3);
    return digits;
  }
  function duplicateScore(card, person) {
    const emails = new Set(arr(card.emails).map(x => String(x?.value || '').trim().toLowerCase()).filter(Boolean));
    const phones = new Set(arr(card.phones).map(x => comparablePhone(x?.value)).filter(x => x.length >= 8));
    const name = comparableName(card?.name?.displayName || [card?.name?.familyName, card?.name?.givenName].filter(Boolean).join(''));
    const existing = contactFromPerson(person);
    if (existing.emails.some(x => emails.has(String(x.value || '').trim().toLowerCase()))) return 3;
    if (existing.phones.some(x => phones.has(comparablePhone(x.value)))) return 2;
    if (name && name === comparableName(existing.name.displayName ||
      [existing.name.familyName, existing.name.givenName].filter(Boolean).join(''))) return 1;
    return 0;
  }
  function safeResourceName(name) {
    if (!/^people\/[-\w]+$/.test(String(name || ''))) throw new Error('聯絡人識別碼格式錯誤。');
    return name;
  }
  const params = values => new URLSearchParams(values).toString();

  async function searchDuplicates(card) {
    const emailQueries = arr(card?.emails).map(x => String(x?.value || '').trim()).filter(Boolean).slice(0, 2);
    const phoneQueries = arr(card?.phones).map(x => String(x?.value || '').trim()).filter(Boolean).slice(0, 3);
    const nameQueries = [card?.name?.displayName, [card?.name?.familyName, card?.name?.givenName].filter(Boolean).join('')]
      .map(x => String(x || '').trim()).filter(Boolean);
    const queries = [...new Set([...emailQueries, ...phoneQueries, ...nameQueries])].slice(0, 7);
    if (!queries.length) return {found: false, candidates: []};
    await request('people:searchContacts?' + params({query: '', readMask: personFields, pageSize: '1'}));
    const matches = new Map();
    for (const query of queries) {
      const result = await request('people:searchContacts?' + params({query, readMask: personFields, pageSize: '30'}));
      for (const item of arr(result.results)) {
        const person = item.person;
        if (!person?.resourceName) continue;
        const score = duplicateScore(card, person);
        if (score && (!matches.has(person.resourceName) || matches.get(person.resourceName).score < score)) {
          matches.set(person.resourceName, {person, score});
        }
      }
    }
    const candidates = [...matches.values()].sort((a, b) => b.score - a.score).slice(0, 10)
      .map(({person}) => {
        const x = contactFromPerson(person);
        return {resourceName: x.resourceName, displayName: x.name.displayName, organization: x.organization.name,
          emails: x.emails.map(y => y.value), phones: x.phones.map(y => y.value)};
      });
    return {found: candidates.length > 0, candidates};
  }

  async function writePhoto(resourceName, dataUrl) {
    const match = String(dataUrl || '').match(/^data:image\/[^;]+;base64,(.+)$/s);
    if (!match) throw new Error('頭像圖片格式錯誤。');
    await request(safeResourceName(resourceName) + ':updateContactPhoto', {method: 'PATCH', body: {photoBytes: match[1]}});
  }
  async function createContact(card, usePhoto, photoDataUrl) {
    const result = await request('people:createContact?' + params({personFields}), {
      method: 'POST', body: personFromContact(card)
    });
    let photoUpdated = false, photoError = '';
    if (usePhoto && photoDataUrl) {
      try { await writePhoto(result.resourceName, photoDataUrl); photoUpdated = true; }
      catch (error) { photoError = error.message; }
    }
    return {contactCreated: true, resourceName: result.resourceName,
      displayName: result.names?.[0]?.displayName || card?.name?.displayName || '',
      photoRequested: !!usePhoto, photoUpdated, photoError};
  }
  async function loadContact(resourceName) {
    return {contact: contactFromPerson(await request(safeResourceName(resourceName) + '?' + params({personFields})))};
  }
  async function photoInfo(resourceName) {
    const person = await request(safeResourceName(resourceName) + '?' + params({personFields: 'photos'}));
    const photo = arr(person.photos).find(x => !x.default) || arr(person.photos)[0];
    return {hasPhoto: !!photo?.url, photoUrl: photo?.url || '', default: !!photo?.default};
  }
  async function updateContact(resourceName, card, choices, useNewPhoto, photoDataUrl) {
    resourceName = safeResourceName(resourceName);
    const old = await request(resourceName + '?' + params({personFields}));
    const incoming = personFromContact(card);
    const fields = {name: 'names', organization: 'organizations', phones: 'phoneNumbers',
      emails: 'emailAddresses', addresses: 'addresses', websites: 'urls', biography: 'biographies'};
    const mask = [];
    for (const [key, field] of Object.entries(fields)) {
      if (choices?.[key]) { old[field] = incoming[field] || []; mask.push(field); }
    }
    if (mask.length) await request(resourceName + ':updateContact?' + params({
      updatePersonFields: mask.join(','), personFields
    }), {method: 'PATCH', body: old});
    let photoUpdated = false, photoError = '';
    if (useNewPhoto && photoDataUrl) {
      try { await writePhoto(resourceName, photoDataUrl); photoUpdated = true; }
      catch (error) { photoError = error.message; }
    }
    return {contactUpdated: mask.length > 0, contactNoChange: mask.length === 0,
      displayName: card?.name?.displayName || '', photoRequested: !!useNewPhoto, photoUpdated, photoError};
  }

  window.NamecardPeople = {
    secureCheckDuplicateContacts: searchDuplicates,
    secureCreateGoogleContactWithOptionalPhoto: createContact,
    secureLoadExistingGoogleContact: loadContact,
    secureGetExistingGoogleContactPhotoInfo: photoInfo,
    secureUpdateGoogleContactWithOptionalPhoto: updateContact,
    getRequestCount: () => peopleRequests,
    clearAuthorization: () => { token = null; tokenExpiresAt = 0; tokenEmail = ''; }
  };
})();
