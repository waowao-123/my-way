(function () {
  const DB_NAME = 'my-space-db';
  const DB_VERSION = 2;
  const STORE = 'todos';
  const DELETED_STORE = 'deleted';
  const LEGACY_KEY = 'myTodos';
  const DAY_MS = 24 * 60 * 60 * 1000;

  let db = null;
  let todos = [];
  let pendingImages = [];
  let editingId = null;
  let expandedId = null;
  let listEl = null;
  let deletedToggleEl = null;
  let deletedSectionEl = null;
  let deletedListEl = null;
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
        if (!database.objectStoreNames.contains(DELETED_STORE)) {
          database.createObjectStore(DELETED_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllFrom(store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function getFrom(store, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function putTo(store, obj) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function deleteFrom(store, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const getAllTodos = () => getAllFrom(STORE);
  const getAllDeleted = () => getAllFrom(DELETED_STORE);
  const getDeleted = (id) => getFrom(DELETED_STORE, id);
  const putTodo = (obj) => putTo(STORE, obj);
  const putDeleted = (obj) => putTo(DELETED_STORE, obj);
  const deleteTodo = (id) => deleteFrom(STORE, id);
  const deleteDeleted = (id) => deleteFrom(DELETED_STORE, id);

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

  // ---------- 工具 ----------
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

  function formatDeletedTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚删除';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前删除`;
    return `${Math.floor(diff / 3600000)} 小时前删除`;
  }

  // ---------- 渲染主列表 ----------
  function render() {
    if (!listEl) return;
    if (todos.length === 0) {
      listEl.innerHTML = '<div class="empty">还没有任务，添加一个吧 ✨</div>';
      return;
    }
    listEl.innerHTML = todos.map(t => {
      const isEditing = t.id === editingId;
      const isExpanded = t.id === expandedId;

      const imgs = (t.images || []).map((blob, i) => {
        const url = getObjectUrl(t.id, i, blob);
        return `
          <div class="thumb-wrap">
            <img class="todo-thumb" src="${url}" alt="任务图片" data-preview="${url}">
            <button class="thumb-del-text" data-thumbdel="${t.id}" data-idx="${i}">删除</button>
          </div>
        `;
      }).join('');

      return `
        <li data-id="${t.id}" class="${t.done ? 'done' : ''} ${isExpanded ? 'expanded' : ''}">
          <div class="todo-main">
            <button class="toggle">✓</button>
            <div class="todo-body">
              ${isEditing
                ? `<div class="edit-row">
                     <input class="edit-input" data-editinput="${t.id}" value="${escapeHtml(t.text)}" maxlength="60">
                     <div class="todo-actions">
                       <button class="action-btn primary" data-save="${t.id}">保存</button>
                       <button class="action-btn" data-cancel="1">取消</button>
                     </div>
                   </div>`
                : `<span class="todo-text" data-toggleexpand="${t.id}">${escapeHtml(t.text)}</span>`
              }
              ${imgs ? `<div class="todo-thumbs">${imgs}</div>` : ''}
            </div>
            ${!isEditing && (t.images && t.images.length > 0) ? `<button class="icon-more" data-toggleexpand="${t.id}" title="更多">⋯</button>` : ''}
            ${!isEditing && (!t.images || t.images.length === 0) ? `<button class="icon-more" data-toggleexpand="${t.id}" title="更多">⋯</button>` : ''}
          </div>
          ${isExpanded && !isEditing ? `
            <div class="todo-actions expanded-actions">
              <button class="action-btn" data-edit="${t.id}">编辑</button>
              ${t.images && t.images.length ? `<button class="action-btn" data-delimg="${t.id}">移除图片</button>` : ''}
              <button class="action-btn danger" data-del="${t.id}">删除</button>
            </div>
          ` : ''}
        </li>
      `;
    }).join('');

    if (editingId) {
      const input = listEl.querySelector(`[data-editinput="${editingId}"]`);
      if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); saveEdit(editingId, input.value); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        });
      }
    }
  }

  async function updateDeletedUI() {
    if (!deletedToggleEl || !deletedSectionEl || !deletedListEl) return;
    const all = await getAllDeleted();
    if (all.length === 0) {
      deletedToggleEl.hidden = true;
      deletedSectionEl.hidden = true;
      return;
    }
    deletedToggleEl.hidden = false;
    deletedToggleEl.textContent = `最近删除 (${all.length})`;
    all.sort((a, b) => b.deletedAt - a.deletedAt);
    deletedListEl.innerHTML = all.map(item => `
      <li class="deleted-item">
        <div class="deleted-info">
          <span class="deleted-text">${escapeHtml(item.text)}</span>
          <span class="deleted-time">${formatDeletedTime(item.deletedAt)}</span>
        </div>
        <button class="action-btn" data-restore="${item.id}">撤销</button>
      </li>
    `).join('');
  }

  // ---------- 编辑 ----------
  function enterEdit(id) {
    editingId = id;
    expandedId = id;
    render();
  }

  async function saveEdit(id, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.text = trimmed;
    await putTodo(todo);
    editingId = null;
    render();
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  // ---------- 删除 / 撤销 ----------
  async function softDelete(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const deleted = { ...todo, deletedAt: Date.now() };
    await putDeleted(deleted);
    await deleteTodo(id);
    revokeTodoUrls(id);
    todos = todos.filter(t => t.id !== id);
    if (editingId === id) editingId = null;
    if (expandedId === id) expandedId = null;
    render();
    await updateDeletedUI();
  }

  async function restoreDeleted(id) {
    const item = await getDeleted(id);
    if (!item) return;
    const { deletedAt, ...todo } = item;
    await putTodo(todo);
    await deleteDeleted(id);
    todos.push(todo);
    todos.sort((a, b) => b.id - a.id);
    render();
    await updateDeletedUI();
  }

  async function cleanupExpiredDeleted() {
    const all = await getAllDeleted();
    const cutoff = Date.now() - DAY_MS;
    for (const item of all) {
      if (item.deletedAt < cutoff) await deleteDeleted(item.id);
    }
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

  // ---------- 导出 ----------
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

  // ---------- 导入 ----------
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
        const existing = await getFrom(STORE, id);
        if (existing) { skipped++; continue; }

        const rawImgs = Array.isArray(item.images) ? item.images : (item.image ? [item.image] : []);
        const images = [];
        for (const img of rawImgs) {
          if (typeof img === 'string' && img.startsWith('data:')) {
            try { images.push(await fetch(img).then(r => r.blob())); } catch (e) {}
          }
        }
        await putTodo({
          id, text: item.text, done: !!item.done,
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

  // ---------- 注册 ----------
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
      <button class="pill-btn deleted-toggle" id="todoDeletedToggle" hidden>最近删除 (0)</button>
      <div class="deleted-section" id="todoDeletedSection" hidden>
        <div class="deleted-header">最近删除（24 小时内可撤销）</div>
        <ul id="todoDeletedList"></ul>
      </div>
      <input type="file" id="todoImportFile" accept="application/json,.json" hidden>
    `,
    async onReady(panel) {
      listEl = panel.querySelector('#todoList');
      deletedToggleEl = panel.querySelector('#todoDeletedToggle');
      deletedSectionEl = panel.querySelector('#todoDeletedSection');
      deletedListEl = panel.querySelector('#todoDeletedList');

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
        await cleanupExpiredDeleted();
        todos = await getAllTodos();
        todos.sort((a, b) => b.id - a.id);
      } catch (e) {
        console.error('IndexedDB 初始化失败', e);
        listEl.innerHTML = '<div class="empty">数据加载失败，请刷新重试</div>';
        return;
      }
      render();
      await updateDeletedUI();

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
          id: Date.now(), text, done: false,
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

      input.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });

      exportBtn.addEventListener('click', exportBackup);
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const f = importFile.files && importFile.files[0];
        importFile.value = '';
        if (f) await importBackup(f);
      });

      deletedToggleEl.addEventListener('click', () => {
        deletedSectionEl.hidden = !deletedSectionEl.hidden;
      });

      deletedListEl.addEventListener('click', async e => {
        const btn = e.target.closest('[data-restore]');
        if (!btn) return;
        await restoreDeleted(Number(btn.dataset.restore));
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

        if (e.target.dataset.toggleexpand !== undefined) {
          if (editingId === id) return;
          expandedId = expandedId === id ? null : id;
          render();
          return;
        }

        if (e.target.dataset.del !== undefined) {
          await softDelete(id);
          return;
        }

        if (e.target.dataset.thumbdel !== undefined && todo) {
          const idx = Number(e.target.dataset.idx);
          if (Array.isArray(todo.images) && idx >= 0 && idx < todo.images.length) {
            todo.images.splice(idx, 1);
            if (todo.images.length === 0) delete todo.images;
            revokeTodoUrls(id);
            try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          }
          return;
        }

        if (e.target.dataset.delimg !== undefined && todo) {
          delete todo.images;
          revokeTodoUrls(id);
          try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('todo-thumb')) {
          openImageViewer(e.target.dataset.preview);
          return;
        }

        if (e.target.dataset.edit !== undefined) {
          enterEdit(id);
          return;
        }

        if (e.target.dataset.save !== undefined) {
          const inp = li.querySelector('.edit-input');
          if (inp) await saveEdit(id, inp.value);
          return;
        }

        if (e.target.dataset.cancel !== undefined) {
          cancelEdit();
          return;
        }
      });
    }
  });
})();