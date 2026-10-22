(function () {
  const DB_NAME = 'my-space-db';
  const DB_VERSION = 1;
  const STORE = 'todos';
  const LEGACY_KEY = 'myTodos'; // 旧 localStorage key，用于迁移
  const MAX_IMAGE_BYTES = 500 * 1024;
  const MAX_DIMENSION = 800;
  const JPEG_QUALITY = 0.75;

  let db = null;
  let todos = [];              // 内存中的任务列表，按插入顺序（新在前）
  let pendingImageBlob = null; // 输入区待添加的图片 Blob
  let panelEl = null;
  let listEl = null;
  const objectUrls = new Map(); // id -> objectURL，便于释放

  // ---------- IndexedDB 封装 ----------
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
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
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

  function clearTodos() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- 从旧 localStorage 迁移 ----------
  async function migrateFromLocalStorage() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    try {
      const old = JSON.parse(raw);
      if (Array.isArray(old) && old.length > 0) {
        for (const item of old) {
          // 旧数据的 image 可能是 Base64 字符串，转成 Blob
          let imageBlob = null;
          if (item.image && typeof item.image === 'string' && item.image.startsWith('data:')) {
            imageBlob = await dataUrlToBlob(item.image);
          }
          await putTodo({
            id: item.id || Date.now() + Math.random(),
            text: item.text || '',
            done: !!item.done,
            ...(imageBlob ? { image: imageBlob } : {})
          });
        }
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('旧数据迁移失败，保留原 localStorage 数据', e);
    }
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(r => r.blob());
  }

  // ---------- 图片压缩 ----------
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('不是图片文件'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > MAX_DIMENSION) {
            height = Math.round(height * MAX_DIMENSION / width);
            width = MAX_DIMENSION;
          } else if (height >= width && height > MAX_DIMENSION) {
            width = Math.round(width * MAX_DIMENSION / height);
            height = MAX_DIMENSION;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('图片压缩失败')); return; }
            if (blob.size > MAX_IMAGE_BYTES) {
              reject(new Error('图片压缩后仍然太大，请换一张小一点的图'));
              return;
            }
            resolve(blob);
          }, 'image/jpeg', JPEG_QUALITY);
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // ---------- 渲染 ----------
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getObjectUrl(todo) {
    if (!todo.image) return null;
    if (objectUrls.has(todo.id)) return objectUrls.get(todo.id);
    const url = URL.createObjectURL(todo.image);
    objectUrls.set(todo.id, url);
    return url;
  }

  function revokeObjectUrl(id) {
    if (objectUrls.has(id)) {
      URL.revokeObjectURL(objectUrls.get(id));
      objectUrls.delete(id);
    }
  }

  function render() {
    if (!listEl) return;
    if (todos.length === 0) {
      listEl.innerHTML = '<div class="empty">还没有任务，添加一个吧 ✨</div>';
      return;
    }
    listEl.innerHTML = todos.map(t => {
      const url = getObjectUrl(t);
      return `
        <li data-id="${t.id}" class="${t.done ? 'done' : ''}">
          <button class="toggle">✓</button>
          <div class="todo-body">
            <span class="todo-text">${escapeHtml(t.text)}</span>
            ${url ? `<img class="todo-thumb" src="${url}" alt="任务图片" data-preview="${t.id}">` : ''}
          </div>
          ${t.image ? `<button class="del-img" data-delimg="${t.id}" title="移除图片">🖼✕</button>` : ''}
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

  // ---------- 注册工具 ----------
  window.registerTool({
    iconId: 'todoIcon',
    iconText: '📝',
    iconTitle: '待办清单',
    panelId: 'todoPanel',
    panelHTML: `
      <div class="panel-header">
        <h2>待办清单</h2>
        <button class="close-btn" data-close>✕</button>
      </div>
      <div class="input-row">
        <input type="text" id="todoInput" placeholder="今天想完成什么？" maxlength="60">
        <button class="img-pick-btn" id="todoImgBtn" title="添加图片">📷</button>
        <button class="add-btn" id="todoAddBtn">添加</button>
        <input type="file" id="todoImgFile" accept="image/*" hidden>
      </div>
      <div class="image-preview" id="todoImgPreview" hidden>
        <img id="todoImgPreviewEl" alt="预览">
        <button class="img-remove-btn" id="todoImgRemove" title="移除图片">✕</button>
      </div>
      <ul id="todoList"></ul>
    `,
    async onReady(panel) {
      panelEl = panel;
      listEl = panel.querySelector('#todoList');

      const input = panel.querySelector('#todoInput');
      const addBtn = panel.querySelector('#todoAddBtn');
      const imgBtn = panel.querySelector('#todoImgBtn');
      const imgFile = panel.querySelector('#todoImgFile');
      const previewWrap = panel.querySelector('#todoImgPreview');
      const previewEl = panel.querySelector('#todoImgPreviewEl');
      const previewRemove = panel.querySelector('#todoImgRemove');

      // 打开数据库并加载数据
      try {
        db = await openDB();
        await migrateFromLocalStorage();
        todos = await getAllTodos();
        // 新任务在前：按 id 倒序（id 是时间戳）
        todos.sort((a, b) => b.id - a.id);
      } catch (e) {
        console.error('IndexedDB 初始化失败', e);
        listEl.innerHTML = '<div class="empty">数据加载失败，请刷新重试</div>';
        return;
      }
      render();

      imgBtn.addEventListener('click', () => imgFile.click());

      imgFile.addEventListener('change', async () => {
        const file = imgFile.files && imgFile.files[0];
        imgFile.value = '';
        if (!file) return;
        try {
          pendingImageBlob = await compressImage(file);
          previewEl.src = URL.createObjectURL(pendingImageBlob);
          previewWrap.hidden = false;
        } catch (err) {
          alert(err.message || '图片处理失败');
        }
      });

      previewRemove.addEventListener('click', () => {
        if (previewEl.src) URL.revokeObjectURL(previewEl.src);
        pendingImageBlob = null;
        previewEl.src = '';
        previewWrap.hidden = true;
      });

      addBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        const todo = {
          id: Date.now(),
          text,
          done: false,
          ...(pendingImageBlob ? { image: pendingImageBlob } : {})
        };
        try {
          await putTodo(todo);
          todos.unshift(todo);
          input.value = '';
          if (previewEl.src) URL.revokeObjectURL(previewEl.src);
          pendingImageBlob = null;
          previewEl.src = '';
          previewWrap.hidden = true;
          render();
        } catch (e) {
          alert('保存失败，可能是存储空间不足');
          console.warn(e);
        }
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addBtn.click();
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
            revokeObjectUrl(id);
            todos = todos.filter(t => t.id !== id);
            render();
          } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('del-img') && todo) {
          delete todo.image;
          revokeObjectUrl(id);
          try { await putTodo(todo); render(); } catch (err) { console.warn(err); }
          return;
        }

        if (e.target.classList.contains('todo-thumb')) {
          openImageViewer(e.target.src);
        }
      });
    }
  });
})();