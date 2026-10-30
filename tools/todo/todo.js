(function () {
  const DB_NAME = 'my-space-db';
  const DB_VERSION = 1;
  const STORE = 'todos';
  const LEGACY_KEY = 'myTodos';

  let db = null;
  let todos = [];
  let pendingImages = [];
  let listEl = null;
  const objectUrls = new Map();

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllTodos() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function getTodo(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function putTodo(todo) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(todo);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function deleteTodo(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- 迁移旧 localStorage ----------
  async function migrateFromLocalStorage() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    try {
      const old = JSON.parse(raw);
      if (Array.isArray(old) && old.length > 0) {
        for (const item of old) {
          let images = [];
          if (item.images && Array.isArray(item.images)) {
            images = item.images;
          } else if (item.image && typeof item.image === 'string' && item.image.startsWith('data:')) {
            images = [await fetch(item.image).then(r => r.blob())];
          }
          await putTodo({
            id: item.id || Date.now() + Math.random(),
            text: item.text || '',
            done: !!item.done,
            ...(images.length ? { images } : {})
          });
        }
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('旧数据迁移失败', e);
    }
  }

  // ---------- 工具函数 ----------
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function getObjectUrl(id, index, blob) {
    const key = `${id}-${index}`;
    if (objectUrls.has(key)) return objectUrls.get(key);
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
  }

  function revokeTodoUrls(id) {
    for (const key of [...objectUrls.keys()]) {
      if (key.startsWith(`${id}-`)) {
        URL.revokeObjectURL(objectUrls.get(key));
        objectUrls.delete(key);
      }
    }
  }

  // ---------- 渲染 ----------
  function render() {
    if (!listEl) return;
    if (todos.length === 0) {
      listEl.innerHTML = '<div class="empty">还没有任务，添加一个吧 ✨</div>';
      return;
    }
    listEl.innerHTML = todos.map(t => {
      const imgs = (t.images || []).map((blob, i) => {
        const url = getObjectUrl(t.id, i, blob);
        return `
          <div class="thumb-wrap">
            <img class="todo-thumb" src="${url}" alt="任务图片" data-preview="${url}">
            <button class="thumb-del" data-thumbdel="${t.id}" data-idx="${i}" title="删除这张图片">✕</button>
          </div>
        `;
      }).join('');
      return `
        <li data-id="${t.id}" class="${t.done ? 'done' : ''}">
          <button class="toggle">✓</button>
          <div class="todo-body">
            <span class="todo-text">${escapeHtml(t.text)}</span>
            ${imgs ? `<div class="todo-thumbs">${imgs}</div>` : ''}
          </div>
          ${t.images && t.images.length ? `<button class="del-img" data-delimg="${t.id}" title="移除全部图片">🖼✕</button>` : ''}
          <button class="del" title="删除任务">✕</button>
        </li>
      `;
    }).join('');
  }

  // ---------- 图片查看器 ----------
  function openImageViewer(src) {
    const viewer = document.createElement('div');
    viewer.className = 'img-viewer';
    viewer.innerHTML = `<img src="${src}" alt="查看图片">`;
    document.body.appendChild(viewer);
    const close = () => {
      viewer.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    viewer.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  // ---------- 预览区 ----------
  function renderPreview(container) {
    container.innerHTML = '';
    if (pendingImages.length === 0) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    pendingImages.forEach((blob, idx) => {
      const item = document.createElement('div');
      item.className = 'preview-item';
      const url = URL.createObjectURL(blob);
      item.innerHTML = `<img src="${url}" alt="预览"><button class="img-remove-btn" title="移除">✕</button>`;
      item.querySelector('.img-remove-btn').addEventListener('click', () => {
        URL.revokeObjectURL(url);
        pendingImages.splice(idx, 1);
        renderPreview(container);
      });
      container.appendChild(item);
    });
  }

  // ---------- 导出备份 ----------
  async function exportBackup() {
    try {
      const all = await getAllTodos();
      const data = {
        app: 'my-space-todo',
        version: 1,
        exportedAt: new Date().toISOString(),
        todos: []
      };
      for (const t of all) {
        data.todos.push({
          id: t.id,
          text: t.text,
          done: !!t.done,
          images: t.images ? await Promise.all(t.images.map(blobToDataUrl)) : []
        });
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
      a.href = url;
      a.download = `todo-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert('导出失败：' + (e.message || e));
      console.warn(e);
    }
  }

  // ---------- 导入备份 ----------
  async function importBackup(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : (data.todos || []);
      if (!Array.isArray(list) || list.length === 0) {
        alert('备份文件里没有可导入的任务');
        return;
      }
      let added = 0, skipped = 0;
      for (const item of list) {
        if (!item || typeof item.text !== 'string') continue;
        const id = Number(item.id) || Date.now() + Math.random();
        const existing = await getTodo(id);
        if (existing) { skipped++; continue; }

        const rawImgs = Array.isArray(item.images) ? item.images
                       : (item.image ? [item.image] : []);
        const images = [];
        for (const img of rawImgs) {
          if (typeof img === 'string' && img.startsWith('data:')) {
            try {
              images.push(await fetch(img).then(r => r.blob()));
            } catch (e) {}
          }
        }
        await putTodo({
          id,
          text: item.text,
          done: !!item.done,
          ...(images.length ? { images } : {})
        });
        added++;
      }
      todos = await getAllTodos();
      todos.sort((a, b) => b.id - a.id);
      render();
      alert(`导入完成：新增 ${added} 条${skipped ? `，跳过 ${skipped} 条已存在` : ''}`);
    } catch (e) {
      alert('导入失败：' + (e.message || e));
      console.warn(e);
    }
  }

  // ---------- 注册工具 ----------
  window.registerTool({
    iconId: 'todoIcon',
    iconText: '📝',
    iconTitle: '待办清单',
    panelId: 'todoPanel',
    panelHTML: `
      <div class="panel-header">
        <h2>待办清单</h2>
        <div class="header-actions">
          <button class="pill-btn" id="todoExportBtn" title="导出备份文件">⬇️ 导出</button>
          <button class="pill-btn" id="todoImportBtn" title="导入备份文件">⬆️ 导入</button>
          <button class="close-btn" data-close>✕</button>
        </div>
      </div>
      <div class="input-row">
        <input type="text" id="todoInput" placeholder="今天想完成什么？" maxlength="60">
        <button class="img-pick-btn" id="todoImgBtn" title="添加图片">📷 图片</button>
        <button class="add-btn" id="todoAddBtn">添加</button>
        <input type="file" id="todoImgFile" accept="image/*" multiple hidden>
      </div>
      <div class="image-preview" id="todoImgPreview" hidden></div>
      <ul id="todoList"></ul>
      <input type="file" id="todoImportFile" accept="application/json,.json" hidden>
    `,
    async onReady(panel) {
      listEl = panel.querySelector('#todoList');
      const input = panel.querySelector('#todoInput');
      const addBtn = panel.querySelector('#todoAddBtn');
      const imgBtn = panel.querySelector('#todoImgBtn');
      const imgFile = panel.querySelector('#todoImgFile');
      const previewWrap = panel.querySelector('#todoImgPreview');
      const exportBtn = panel.querySelector('#todoExportBtn');
      const importBtn = panel.querySelector('#todoImportBtn');
      const importFile = panel.querySelector('#todoImportFile');

      try {
        db = await openDB();
        await migrateFromLocalStorage();
        todos = await getAllTodos();
        todos.sort((a, b) => b.id - a.id);
      } catch (e) {
        console.error('IndexedDB 初始化失败', e);
        listEl.innerHTML = '<div class="empty">数据加载失败，请刷新重试</div>';
        return;
      }
      render();

      imgBtn.addEventListener('click', () => imgFile.click());

      imgFile.addEventListener('change', () => {
        const files = Array.from(imgFile.files || []);
        imgFile.value = '';
        files.forEach(file => {
          if (file.type.startsWith('image/')) pendingImages.push(file);
        });
        renderPreview(previewWrap);
      });

      addBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        const todo = {
          id: Date.now(),
          text,
          done: false,
          ...(pendingImages.length ? { images: [...pendingImages] } : {})
        };
        try {
          await putTodo(todo);
          todos.unshift(todo);
          input.value = '';
          pendingImages = [];
          renderPreview(previewWrap);
          render();
        } catch (e) {
          alert('保存失败，可能是存储空间不足');
          console.warn(e);
        }
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addBtn.click();
      });

      exportBtn.addEventListener('click', exportBackup);
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const f = importFile.files && importFile.files[0];
        importFile.value = '';
        if (f) await importBackup(f);
      });

      listEl.addEventListener('click', async e => {
        const li = e.target.closest('li');
        if (!li) return;
        const id = Number(li.dataset.id);
        const todo = todos.find(t => t.id === id);

        if (e.target.classList.contains('toggle') && todo) {
          todo.done = !todo.done;
          try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('del')) {
          try {
            await deleteTodo(id);
            revokeTodoUrls(id);
            todos = todos.filter(t => t.id !== id);
            render();
          } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('thumb-del') && todo) {
          const idx = Number(e.target.dataset.idx);
          if (Array.isArray(todo.images) && idx >= 0 && idx < todo.images.length) {
            todo.images.splice(idx, 1);
            if (todo.images.length === 0) delete todo.images;
            revokeTodoUrls(id);
            try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          }
          return;
        }

        if (e.target.classList.contains('del-img') && todo) {
          delete todo.images;
          revokeTodoUrls(id);
          try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('todo-thumb')) {
          openImageViewer(e.target.dataset.preview);
        }
      });
    }
  });
})();