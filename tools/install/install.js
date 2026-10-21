(function () {
  let deferredPrompt = null;
  let installed = false;

  // 监听安装事件
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updatePanelUI();
  });

  // 监听安装完成
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    updatePanelUI();
  });

  // 检测是否已经在独立窗口运行（已安装）
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    installed = true;
  }

  let panelEl = null;

  window.registerTool({
    iconId: 'installIcon',
    iconText: '⬇️',
    iconTitle: '安装应用',
    panelId: 'installPanel',
    panelHTML: `
      <div class="panel-header">
        <h2>安装应用</h2>
        <button class="close-btn" data-close>✕</button>
      </div>
      <div class="install-wrap" id="installWrap">
        <div class="install-icon">📲</div>
        <p class="install-desc" id="installDesc">正在检测安装状态...</p>
        <button class="pomo-btn primary" id="installBtn" style="display:none;">安装到桌面</button>
        <div class="install-tips" id="installTips"></div>
      </div>
    `,
    onReady(panel) {
      panelEl = panel;
      updatePanelUI();
    }
  });

  function updatePanelUI() {
    if (!panelEl) return;
    const desc = panelEl.querySelector('#installDesc');
    const btn = panelEl.querySelector('#installBtn');
    const tips = panelEl.querySelector('#installTips');

    if (installed) {
      desc.textContent = '你已经安装过了，直接从桌面打开即可离线使用。';
      btn.style.display = 'none';
      tips.innerHTML = '';
      return;
    }

    if (deferredPrompt) {
      desc.textContent = '把 My Space 安装到桌面，像 App 一样打开，离线也能用。';
      btn.style.display = 'inline-block';
      tips.innerHTML = '';
      btn.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          installed = true;
        }
        deferredPrompt = null;
        updatePanelUI();
      };
      return;
    }

    // 不支持自动安装的浏览器
    btn.style.display = 'none';
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      desc.textContent = 'iOS 上需要手动添加到主屏幕：';
      tips.innerHTML = '点击 Safari 底部的 <b>分享</b> 按钮 → 选择 <b>添加到主屏幕</b>。';
    } else if (/Firefox/i.test(ua)) {
      desc.textContent = 'Firefox 暂不支持安装 PWA。';
      tips.innerHTML = '请用 <b>Chrome</b> 或 <b>Edge</b> 打开本页面，地址栏右侧会出现安装图标。';
    } else {
      desc.textContent = '当前浏览器没有提供安装入口。';
      tips.innerHTML = '请用 <b>Chrome</b> 或 <b>Edge</b> 打开，地址栏右侧会出现安装图标；或者从浏览器菜单里选择“安装应用”。';
    }
  }
})();