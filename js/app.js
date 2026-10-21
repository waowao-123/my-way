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
    // 外层容器：图标 + 标签竖排
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
})();