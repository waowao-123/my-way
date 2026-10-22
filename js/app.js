(function () {
  const overlay = document.getElementById('overlay');
  const dock = document.getElementById('dock');
  const panelRoot = document.getElementById('panelRoot');

  function closeAllPanels() {
    document.querySelectorAll('.panel.show').forEach(p => p.classList.remove('show'));
    overlay.classList.remove('show');
  }

  window.bindPanel = function (icon, panel) {
    if (!icon || !panel) return;

    icon.addEventListener('click', () => {
      const isOpen = panel.classList.contains('show');
      closeAllPanels();
      if (!isOpen) {
        panel.classList.add('show');
        overlay.classList.add('show');
        const firstInput = panel.querySelector('input');
        if (firstInput) setTimeout(() => firstInput.focus(), 300);
      }
    });

    panel.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', closeAllPanels);
    });
  };

  overlay.addEventListener('click', closeAllPanels);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllPanels();
  });

  window.registerTool = function ({ iconId, iconText, iconTitle, panelId, panelHTML, onReady }) {
    const wrap = document.createElement('div');
    wrap.className = 'dock-item';

    const btn = document.createElement('button');
    btn.className = 'dock-btn';
    btn.id = iconId;
    btn.title = iconTitle || '';
    btn.textContent = iconText;

    const label = document.createElement('span');
    label.className = 'dock-label';
    label.textContent = iconTitle || '';

    wrap.appendChild(btn);
    wrap.appendChild(label);
    dock.appendChild(wrap);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = panelId;
    panel.innerHTML = panelHTML;
    panelRoot.appendChild(panel);

    window.bindPanel(btn, panel);

    if (typeof onReady === 'function') onReady(panel, btn);
  };

  // ---------- 新版本提示 ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update();

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    }).catch(err => {
      console.warn('Service Worker 注册失败：', err);
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function showUpdateBanner(newWorker) {
    if (document.getElementById('updateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>有新版本可用</span>
      <button id="updateNowBtn">立即刷新</button>
      <button id="updateLaterBtn" title="稍后">✕</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#updateNowBtn').addEventListener('click', () => {
      newWorker.postMessage({ type: 'SKIP_WAITING' });
      banner.remove();
    });

    banner.querySelector('#updateLaterBtn').addEventListener('click', () => {
      banner.remove();
    });
  }
})();