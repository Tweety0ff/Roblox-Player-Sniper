// the entire script in an async function because I need await ¯\_(ツ)_/¯
(async() => {
  const [, place] = window.location.href.match(/games\/(\d+)\//);
  
  // Load panel

  function waitForElm(selector) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) resolve(document.querySelector(selector));
  
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          resolve(document.querySelector(selector));
          observer.disconnect();
        }
      });
  
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }
  
  const div = document.createElement('div');
  div.id = 'rorsl-panel';
  div.innerHTML = await fetch(chrome.runtime.getURL('html/main.html')).then(res => res.text())
  if (document.body.classList.contains('dark-theme')) div.classList.add('dark');
  div.style.display = 'none';
  const mainContainer = await waitForElm('#container-main');
  mainContainer.parentNode.insertBefore(div, mainContainer);
  // большая панель живёт в <body>, чтобы не зависеть от вёрстки страницы
  const modal = div.querySelector('#rorsl-modal');
  document.body.appendChild(modal);

  // Done injecting panel

  const COLORS = {
    GREEN: '#00b06f',
    BLUE: '#0077ff',
    RED: '#ff3e3e',
  };

  const { getURL } = chrome.runtime;

  const sleep = time => new Promise(res => setTimeout(res, time * 1000));

  const get = async (url, includeCreds = false, attempts = 0) => {
    try {
      const creds = includeCreds ? 'include' : 'omit';
      const request = await fetch(`https://${url}`, {credentials: creds});
      if (!request.ok) throw new Error('Request failed');

      return await request.json();
    } catch (error) {
      if (attempts >= 15) throw error; // stop infinite retry
      await sleep(0.5 + attempts * 0.15);
      return await get(url, includeCreds, attempts + 1);
    }
  };

  const post = async (url, body, attempts = 0) => {
    try {
      const request = await fetch(`https://${url}`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!request.ok) throw new Error('Request failed');

      return await request.json();
    } catch (error) {
      if (attempts >= 15) throw error;
      await sleep(0.5 + attempts * 0.15);
      return await post(url, body, attempts + 1);
    }
  };
  
  const openButton = document.getElementById('rorsl-open');
  const closeButton = document.getElementById('rorsl-close');
  const themeButton = document.getElementById('rorsl-theme');
  const userNameEl = document.getElementById('rorsl-userName');
  const resultsList = document.getElementById('rorsl-results');
  const reloadButtonContainer = document.getElementById('rorsl-reload-container');
  const reloadButton = document.getElementById('rorsl-reload');
  const searchButtonContainer = document.getElementById('rorsl-search-container');
  const searchButton = document.getElementById('rorsl-search');
  const userImage = document.getElementById('rorsl-userImage');
  const status = document.getElementById('rorsl-status');
  const pageNum = document.getElementById('rorsl-page');
  const userStatus = document.getElementById('rorsl-userStatus');
  userImage.addEventListener('load', () => userImage.classList.add('is-loaded'));
  userImage.addEventListener('error', () => userImage.classList.add('is-loaded'));
  const pageStatusEnd = document.getElementById('rorsl-maxPagesEnd');
  let panelReady = false;

  // состояние панели для CSS: loading / done / empty / error (см. [data-state] в main.css)
  const STATES = { [COLORS.BLUE]: 'loading', [COLORS.GREEN]: 'done', [COLORS.RED]: 'empty' };
  const setState = state => { modal.dataset.state = state; };
  const color = hex => setState(STATES[hex]);

  let foundAllServers = false;
  let searchFailed = false;
  let allPlayers = [];
  let playersCount = 0;
  let playersChecked = 0;
  let maxPlayers = 0;

  let maxServersPerPage = 15;
  let maxPages = 1;
  let page = 1;

  let playerImageUrl;
  let playerUrlReady = false;

  let targetServerIds = {
    serverId: "",
    serverSize: 0
  };
  const serverIds = new Map();

  const friendServers = new Map();
  const allThumbnails = new Map();

  chrome.storage.local.get(['defaultsV2', 'listSize']).then(value => {
    if (!value.defaultsV2) {
      chrome.storage.local.set({ defaultsV2: true, listSize: 15 });
      maxServersPerPage = 15;
      $("#rorsl-listSize").val(15);
    }
  });

  chrome.storage.local.get('autoAttach').then(value => {
    if (value.autoAttach) searchServers();
  });

  async function fetchServers(fastSearch = false, pass = 1, cursor = '', attempts = 0) {
    const { nextPageCursor, data } = await get(`games.roblox.com/v1/games/${place}/servers/Public?limit=100&cursor=${cursor}`, fastSearch);
    // Friends
    if (pass == 1 && cursor == '') {
      const { id } = await get(`users.roblox.com/v1/users/authenticated`, true);
      const { data } = await get(`friends.roblox.com/v1/users/${id}/friends`, true);
      const friendIds = [];
      data.forEach((friend) => {
        friendIds.push(friend.id);
      });
      if (friendIds.length > 0) {
        const { data } = await get(`games.roblox.com/v1/games/${place}/servers/Friend?limit=100`,true);
        data.forEach((server) => {
          server.players.forEach((player) => {
            if (friendIds.includes(player.id)) {
              const friends = friendServers.get(server.id) || [];
              if (friends.length == 0) friendServers.set(server.id, friends);
              friends.push(player);
            }
          });
        });
      }
    }
    status.innerText = `Discovering... (Bigger games require longer searches!) Pass ${pass}, ${serverIds.size} Servers Found`;
    if (attempts >= 30) return;

    if (!data || data.length === 0) {
      if (!nextPageCursor) return;
      await sleep(1);
      return fetchServers(fastSearch, pass, cursor, attempts + 1);
    }

    data.forEach((server) => {
      if (!serverIds.has(server.id))
        server.playerTokens.forEach((playerToken) => {
          serverIds.set(server.id, server.playing);
          playersCount += 1;
          allPlayers.push({
            token: playerToken,
            type: 'AvatarHeadshot',
            size: '150x150',
            requestId: server.id,
          });
        });
      maxPlayers = server.maxPlayers;
    });
    
    if (!nextPageCursor) return;
    return fetchServers(fastSearch, pass, nextPageCursor);
  }

  async function findTarget() {
    while (true) {
      const chosenPlayers = [];

      for (let i = 0; i < 100; i++) {
        const playerToken = allPlayers.shift();
        if (!playerToken) break;
        chosenPlayers.push(playerToken);
      }

      if (!chosenPlayers.length) {
        await sleep(0.1);
        if (playersChecked === playersCount && foundAllServers) {
          break;
        }
        continue;
      }

      post('thumbnails.roblox.com/v1/batch', JSON.stringify(chosenPlayers)).then(({ data: thumbnailsData }) => {

        thumbnailsData.forEach((thumbnailData) => {
          const thumbnails = allThumbnails.get(thumbnailData.requestId) || [];

          if (thumbnails.length == 0) {
            allThumbnails.set(thumbnailData.requestId, thumbnails);
          }

          playersChecked += 1;

          thumbnails.push(thumbnailData.imageUrl);

          //const foundTarget = thumbnailData.imageUrl === imageUrl ? thumbnailData.requestId : null;

          let containsId = false;
          targetServerIds.forEach((targetServerId) => {
            if (targetServerId.serverId == thumbnailData.requestId) containsId = true;
          });
          if (!containsId) targetServerIds.push({serverId: thumbnailData.requestId});
        });
      });
    }
    targetServerIds.forEach((targetServerId) => {
      targetServerId.serverSize = serverIds.get(targetServerId.serverId)//allThumbnails.get(targetServerId.serverId).length;
    });
    if (targetServerIds.length) {
      targetServerIds.forEach(targetServerId => {
        const thumbnails = allThumbnails.get(targetServerId.serverId);
        thumbnails.reverse();
      })
      preLoadServers();
    } else if (searchFailed) {
      setState('error');
      status.innerText = 'Search failed. Check your connection and try again.';
      searchButton.disabled = false;
      searchButtonContainer.style.opacity = '100%';
    } else {
      color(COLORS.RED);
      status.innerText = 'No servers found.';
      searchButton.disabled = false;
      searchButtonContainer.style.opacity = '100%';
    }
  }

  async function updateUser() {
    try {
      let userName = "Roblox";
      await chrome.storage.local.get('username').then(value => {
        if (userName != undefined) userName = value.username;
      });
      userNameEl.textContent = userName;
      userImage.classList.remove('is-loaded');
      const { data: [{ id }] } = await post('users.roblox.com/v1/usernames/users', `{"usernames": ["${userName}"],"excludeBannedUsers": false}`)
      const { data: [{ imageUrl }] } = await get(`thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`);
      userStatus.innerText = '';
      userImage.src = imageUrl;
      if (imageUrl.includes('https://tr.rbxcdn.com')) playerImageUrl = imageUrl;
      else userStatus.innerText = 'User thumbnail is a common error thumbnail, unable to find user';
      playerUrlReady = true;
    } catch (error) {
      userStatus.innerText = 'Username is Invalid for thumbnail, unable to find user';
      userImage.src = 'https://t6.rbxcdn.com/b48637b2a6266bd379a09afb5a8d5131';
      playerUrlReady = true;
    }
  };

  async function searchServers() {
    searchButton.disabled = true;
    reloadButton.disabled = true;
    pageNum.parentElement.style.display = 'none';
    searchButtonContainer.style.opacity = '50%';
    reloadButtonContainer.style.opacity = '50%';
    if (div.hasAttribute('page-shown')) div.removeAttribute('page-shown');

    targetServerIds = [];
    serverIds.clear();
    friendServers.clear();
    allThumbnails.clear();
    foundAllServers = false;
    searchFailed = false;
    allPlayers = [];
    playersCount = 0;
    playersChecked = 0;
    maxPlayers = 0;

    status.innerText = 'Discovering... (Bigger games require longer searches!) Pass 1, 0 Servers Found';
    color(COLORS.BLUE);
    deleteRorslServers();
    playerUrlReady = false;
    updateUser();

    const fastSearch = true; // Faster Searching всегда включён
    var passes = 1;
    await chrome.storage.local.get('searchPasses').then(value => {
      if (!isNaN(value.searchPasses)) passes = value.searchPasses;
      if (passes < 1) passes = 1;
      if (passes > 10) passes = 10;
    });

    findTarget();
    try {
      for (var pass = 0; pass < passes; pass++)
        if (!foundAllServers) await fetchServers(fastSearch, pass+1);
    } catch (error) {
      searchFailed = true;
    }
    foundAllServers = true;
  }

  async function deleteRorslServers() {
    resultsList.textContent = '';
  }

  async function preLoadServers() {
    targetServerIds.sort((a, b) => {
      return b.serverSize - a.serverSize;
    });
    await chrome.storage.local.get('descending').then(value => {
      if (value.descending) targetServerIds.reverse();
    });
    
    await chrome.storage.local.get('listSize').then(value => {
      if (!isNaN(value.listSize)) maxServersPerPage = value.listSize;
      if (maxServersPerPage < 1) maxServersPerPage = 1;
      if (maxServersPerPage > 250) maxServersPerPage = 250;
    });

    maxPages = 1;
    let serverCount = targetServerIds.length;
    while (serverCount > maxServersPerPage) {
      maxPages += 1;
      serverCount -= maxServersPerPage;
    }

    if (page > maxPages) {
      page = maxPages;
      pageNum.value = maxPages;
    }

    while (!playerUrlReady) await sleep(.1);
    if (!userStatus.innerText.includes('Username is Invalid for thumbnail') && !userStatus.innerText.includes('User thumbnail is a common error thumbnail'))
      for (let i = 0; i < targetServerIds.length; i++) {
        const thumbnails = allThumbnails.get(targetServerIds[i].serverId);
        for (let j = 0; j < thumbnails.length; j++) {
          if (thumbnails[j] === playerImageUrl ? thumbnails[j] : null) {
            let serverCount = i + 1;
            let serverPage = 1;
            while (serverCount > maxServersPerPage) {
              serverCount -= maxServersPerPage;
              serverPage++;
            }
            if (!userStatus.innerText.includes('User found!'))
              userStatus.innerText += ' User found! Server on page ' + serverPage;
          }
        }
      }
    if (!userStatus.innerText.includes('User found!') && !userStatus.innerText.includes('User not found') && !userStatus.innerText.includes('Username is Invalid for thumbnail') && !userStatus.innerText.includes('User thumbnail is a common error thumbnail'))
      userStatus.innerText += ' User not found';
    loadServers();
  };


  // ---- Region / uptime / Job ID (data from the RoValra public API) ----
  const serverInfo = new Map();

  const formatUptime = (sec, precise) => {
    if (sec == null || sec < 0) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm' + (precise ? '' : ' ~');
  };

  function showInfo(item, animate) {
    const box = item.querySelector('.rorsl-info');
    const info = serverInfo.get(box.dataset.job);
    const btn = item.querySelector('.rorsl-getinfo');
    const regionEl = box.querySelector('.rorsl-region'), uptimeEl = box.querySelector('.rorsl-uptime');
    const rows = [...box.querySelectorAll('.rorsl-info-extra')];
    const reveal = () => {
      rows.forEach(r => { r.hidden = false; });
      regionEl.textContent = (info && info.region) || '—';
      regionEl.title = regionEl.textContent;
      if (info && info.base) { uptimeEl.dataset.base = info.base; uptimeEl.dataset.precise = info.precise ? '1' : ''; uptimeEl.textContent = formatUptime((Date.now() - info.base) / 1000, info.precise); }
      else uptimeEl.textContent = '—';
      if (btn) btn.hidden = true;
    };
    const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || calm || !box.animate) { reveal(); return; }

    // The button turns into the info block in place: one continuous height animation,
    // the button cross-fades out while the rows fade in.
    const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const zone = item.querySelector('.rorsl-infozone');
    const h0 = zone.offsetHeight;
    zone.style.height = h0 + 'px';
    zone.style.overflow = 'hidden';
    btn.style.cssText = 'position:absolute;left:0;right:0;top:0;';
    reveal();                       // hides the button (it is faded out below)
    btn.hidden = false;
    const h1 = box.offsetHeight;
    const done = () => { zone.style.height = ''; zone.style.overflow = ''; btn.hidden = true; btn.style.cssText = ''; };
    zone.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, easing: ease })
      .finished.then(done, done);
    btn.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
    box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 80, easing: 'ease-out', fill: 'backwards' });
    rows.forEach((r, i) => r.animate([
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 340, delay: 120 + 70 * i, easing: ease, fill: 'backwards' }));
  }

  // One server per click, so the RoValra API is only hit on demand
  async function getServerInfo(item) {
    const btn = item.querySelector('.rorsl-getinfo');
    const id = item.querySelector('.rorsl-info').dataset.job;
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Loading…'; btn.classList.add('is-loading');
    const res = await new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type: 'rorsl server details', placeId: place, ids: [id] }, r => resolve(chrome.runtime.lastError ? null : r)); }
      catch (e) { resolve(null); }
    });
    if (!res || res.failed) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = 'Failed — try again'; return; }
    const s = (res.servers || []).find(x => x.server_id === id);
    let info = { region: '', base: 0 };
    if (s) {
      const parts = [s.city, s.region && s.region !== s.city ? s.region : null, s.country].filter(p => p && p !== 'Unknown');
      const t = s.first_seen ? new Date(String(s.first_seen).endsWith('Z') ? s.first_seen : s.first_seen + 'Z').getTime() : NaN;
      info = { region: [...new Set(parts)].join(', '), base: isNaN(t) ? 0 : t };
    }
    serverInfo.set(id, info);
    showInfo(item, true);   // same animation whether or not RoValra knows the server
  }

  // live uptime tick
  setInterval(() => {
    resultsList.querySelectorAll('.rorsl-uptime[data-base]').forEach(el => {
      el.textContent = formatUptime((Date.now() - Number(el.dataset.base)) / 1000, !!el.dataset.precise);
    });
  }, 1000);

  // click Job ID = copy
  resultsList.addEventListener('click', e => {
    const gi = e.target.closest('.rorsl-getinfo');
    if (gi) { getServerInfo(gi.closest('li')); return; }
    const btn = e.target.closest('.rorsl-jobid');
    if (!btn) return;
    const id = btn.textContent.trim() === 'Copied' ? btn.dataset.id : btn.textContent.trim();
    btn.dataset.id = id;
    const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = id; }, 1200); };
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = id; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) {}
      t.remove(); done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done, fallback);
    else fallback();
  });

  async function loadServers() {
    if (!panelReady)
      setTimeout(loadServers, 100);
    else {
      deleteRorslServers();

      for (let serverNumber = maxServersPerPage * (page - 1); serverNumber < maxServersPerPage * page; serverNumber++) {
        if (serverNumber >= targetServerIds.length)
          break;
        color(COLORS.GREEN);

        const item = document.createElement('li');
        item.style.setProperty('--i', serverNumber - maxServersPerPage * (page - 1));
        const thumbnails = allThumbnails.get(targetServerIds[serverNumber].serverId);

        let friendTags = '';
        if (friendServers.has(targetServerIds[serverNumber].serverId)) {
          const friends = friendServers.get(targetServerIds[serverNumber].serverId);
          friendTags = friends.map(friend => `<a class="rorsl-friend" href="https://www.roblox.com/users/${friend.id}/profile">${friend.displayName}</a>`).join('');
        }
        item.className = 'rorsl-server';
        var itemHtml = `<div class="rorsl-avatars">
          ${thumbnails.map((url, n) => `<span class="rorsl-avatar" style="--a:${n}"><img src="${url}" alt=""></span>`).join('')}`;
        var hiddenPlayers = targetServerIds[serverNumber].serverSize - thumbnails.length;
        if (hiddenPlayers > 0) itemHtml += `<span class="rorsl-avatar rorsl-avatar--more" style="--a:${thumbnails.length}">+${hiddenPlayers}</span>`;
        itemHtml += `</div>
          <p class="rorsl-server-meta">${targetServerIds[serverNumber].serverSize} of ${maxPlayers} people max</p>
          <div class="rorsl-infozone">
          <dl class="rorsl-info" data-job="${targetServerIds[serverNumber].serverId}">
            <div class="rorsl-info-extra" hidden><dt>Region</dt><dd class="rorsl-region"></dd></div>
            <div class="rorsl-info-extra" hidden><dt>Uptime</dt><dd class="rorsl-uptime"></dd></div>
            <div class="rorsl-info-extra" hidden><dt>Job ID</dt><dd><button type="button" class="rorsl-jobid" title="Click to copy Job ID">${targetServerIds[serverNumber].serverId}</button></dd></div>
          </dl>
          <button type="button" class="rorsl-getinfo">Get server info</button>
          </div>`;
        if (friendTags.length > 0) itemHtml += `<p class="rorsl-friends">Friends: ${friendTags}</p>`;
        itemHtml += `<button onclick='Roblox.GameLauncher.joinGameInstance(${place}, "${targetServerIds[serverNumber].serverId}")' type="button" class="rorsl-join">Join</button>`;
        item.innerHTML = itemHtml;

        for (let j = 0; j < thumbnails.length; j++)
          if (thumbnails[j].includes(playerImageUrl))
            item.classList.add('is-match');

        resultsList.appendChild(item);
        if (serverInfo.has(item.querySelector('.rorsl-info').dataset.job)) showInfo(item);

        status.innerText = `Search completed, ${serverIds.size} Servers Found`;
      }
      searchButton.disabled = false;
      searchButtonContainer.style.opacity = '100%';
      
      pageStatusEnd.innerText = ' of ' + maxPages;
      pageNum.parentElement.style.display = 'inherit';
      div.setAttribute('page-shown', true);
      reloadButtonContainer.style.opacity = '100%';
      reloadButton.disabled = false;
    }
  };

  // Тема: по умолчанию как у Roblox; кнопка-переключатель задаёт свой выбор (запоминается)
  let themeOverride = null;
  const robloxTheme = () => document.body.classList.contains('light-theme') ? 'light' : 'dark';
  const applyTheme = theme => {
    div.dataset.theme = theme;
    modal.dataset.theme = theme;
    themeButton.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  };
  applyTheme(robloxTheme());
  new MutationObserver(() => { if (!themeOverride) applyTheme(robloxTheme()); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  chrome.storage.local.get('rorslTheme').then(value => {
    if (value.rorslTheme === 'light' || value.rorslTheme === 'dark') {
      themeOverride = value.rorslTheme;
      applyTheme(themeOverride);
    }
  });
  themeButton.addEventListener('click', () => {
    const next = modal.dataset.theme === 'light' ? 'dark' : 'light';
    themeOverride = next;
    div.classList.add('rorsl-theming');
    modal.classList.add('rorsl-theming');
    applyTheme(next);
    chrome.storage.local.set({ rorslTheme: next });
    setTimeout(() => {
      div.classList.remove('rorsl-theming');
      modal.classList.remove('rorsl-theming');
    }, 500);
  });

  const openModal = () => {
    modal.setAttribute('open', '');
    document.documentElement.classList.add('rorsl-lock');
    closeButton.focus();
  };
  const closeModal = () => {
    modal.removeAttribute('open');
    document.documentElement.classList.remove('rorsl-lock');
    openButton.focus();
  };
  openButton.addEventListener('click', event => { event.preventDefault(); openModal(); });
  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('mousedown', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.hasAttribute('open')) closeModal();
  });

  // Enter в поле ника запускает поиск
  document.getElementById('rorsl-username').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !searchButton.disabled) searchServers();
  });

  reloadButton.addEventListener('click', async event => {
    event.preventDefault();

    await updateUser();
    preLoadServers();
  });

  searchButton.addEventListener('click', async event => {
    event.preventDefault();

    searchServers();
  });

  pageNum.addEventListener('input', async event => {
    event.preventDefault();
    pageNum.value = pageNum.value.replace(/[e\+\-]/gi, "");
    if (pageNum.value == '')
      page = 1;
    else if (pageNum.value > maxPages)
      pageNum.value = maxPages;
    else if (pageNum.value < 1)
      pageNum.value = 1;
    else
      page = pageNum.value;
    loadServers();
  });

  async function loadSettings() {
    chrome.storage.local.get("autoAttach").then((value) => {
      if (!value.autoAttach) {
        chrome.storage.local.set({ autoAttach: false });
        $("#rorsl-autoAttach").prop("checked", false);
      } else {
        $("#rorsl-autoAttach").prop("checked", value.autoAttach);
      }
    });

    chrome.storage.local.get("listSize").then((value) => {
      if (!value.listSize || value.listSize < 1 || value.listSize > 250) {
        chrome.storage.local.set({ listSize: 15 });
        $("#rorsl-listSize").val(15);
      } else {
        $("#rorsl-listSize").val(value.listSize);
      }
    });
  
    chrome.storage.local.get("descending").then((value) => {
      if (!value.descending) {
        chrome.storage.local.set({ descending: false });
        $("#rorsl-descending").prop("checked", false);
      } else {
        $("#rorsl-descending").prop("checked", value.descending);
      }
    });
  
    chrome.storage.local.get("username").then((value) => {
      if (value.username == undefined) {
        chrome.storage.local.set({ username: "Roblox" });
        $("#rorsl-username").val("Roblox");
      } else {
        $("#rorsl-username").val(value.username);
      }
    });

    // Advanced (раньше жили на отдельной странице)
    chrome.storage.local.get("settingsSync").then((value) => {
      $("#rorsl-settingsSync").prop("checked", value.settingsSync !== false);
    });

    chrome.storage.local.get("searchPasses").then((value) => {
      if (!value.searchPasses || value.searchPasses < 1) {
        chrome.storage.local.set({ searchPasses: 1 });
        $("#rorsl-searchPasses").val(1);
      } else {
        $("#rorsl-searchPasses").val(value.searchPasses);
      }
    });
  }
  
  $(function () {
    loadSettings();
    $("#rorsl-autoAttach").change(function () {
      chrome.storage.local.set({ autoAttach: this.checked });
      chrome.runtime.sendMessage("rorsl background refresh settings");
    });

    $("#rorsl-listSize").on("input", function () {
      var size = $("#rorsl-listSize").val();
      size = size.replace(/[e\+\-]/gi, "");
      $("#rorsl-listSize").val(size);
      if (size && size > 0 && size < 251) {
        chrome.storage.local.set({ listSize: size });
      } else if (size < 1) {
        chrome.storage.local.set({ listSize: 1 });
        $('#rorsl-listSize').val(1);
      } else if (size > 250) {
        chrome.storage.local.set({ listSize: 250 });
        $('#rorsl-listSize').val(250);
      }
      chrome.runtime.sendMessage("rorsl background refresh settings");
    });
  
    $("#rorsl-descending").change(function () {
      chrome.storage.local.set({ descending: this.checked });
      chrome.runtime.sendMessage("rorsl background refresh settings");
    });
  
    $("#rorsl-settingsSync").change(function () {
      chrome.storage.local.set({ settingsSync: this.checked });
    });

    $("#rorsl-searchPasses").on("input", function () {
      var size = $("#rorsl-searchPasses").val();
      size = size.replace(/[e\+\-]/gi, "");
      $("#rorsl-searchPasses").val(size);
      if (size && size > 0 && size < 11) {
        chrome.storage.local.set({ searchPasses: size });
      } else if (size > 10) {
        chrome.storage.local.set({ searchPasses: 10 });
        $("#rorsl-searchPasses").val(10);
      } else if (size < 1) {
        chrome.storage.local.set({ searchPasses: 1 });
        $("#rorsl-searchPasses").val(1);
      }
    });

    $("#rorsl-username").on("input", function () {
      var username = $("#rorsl-username").val();
      username = username.replace(/[\W ]+/g, "");
      $("#rorsl-username").val(username);
      if (username != undefined) {
        chrome.storage.local.set({ username: username });
      }
      chrome.runtime.sendMessage("rorsl background refresh settings");
    });
  });
  
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request == "rorsl refresh settings") loadSettings();
  });

  const runningGames = await waitForElm('#rbx-public-running-games');
  runningGames.parentNode.insertBefore(div, runningGames);
  div.style.display = 'block';
  panelReady = true;
})();