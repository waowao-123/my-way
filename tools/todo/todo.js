(function () {
  const STORAGE_KEY = 'myTodos';
  let todos = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

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
        <button class="add-btn" id="todoAddBtn">添加</button>
      </div>
      <ul id="todoList"></ul>
    `,
    onReady(panel) {
      const input = panel.querySelector('#todoInput');
      const addBtn = panel.querySelector('#todoAddBtn');
      const list = panel.querySelector('#todoList');

      function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
        render();
      }

      function escapeHtml(str) {
        return str.replace(/[&<>"']/g, c => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
      }

      function render() {
        if (todos.length === 0) {
          list.innerHTML = '<div class="empty">还没有任务，添加一个吧 ✨</div>';
          return;
        }
        list.innerHTML = todos.map(t => `
          <li data-id="${t.id}" class="${t.done ? 'done' : ''}">
            <button class="toggle">✓</button>
            <span class="todo-text">${escapeHtml(t.text)}</span>
            <button class="del">✕</button>
          </li>
        `).join('');
      }

      addBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;
        todos.unshift({ id: Date.now(), text, done: false });
        input.value = '';
        save();
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') addBtn.click();
      });

      list.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li) return;
        const id = Number(li.dataset.id);

        if (e.target.classList.contains('toggle')) {
          const todo = todos.find(t => t.id === id);
          if (todo) { todo.done = !todo.done; save(); }
        }
        if (e.target.classList.contains('del')) {
          todos = todos.filter(t => t.id !== id);
          save();
        }
      });

      render();
    }
  });
})();