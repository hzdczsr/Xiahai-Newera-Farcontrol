// tasks.js - 任务列表模块
// 任务创建、切换、删除、重命名

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  let renameTarget = null;

  M.on('tab:tasks', () => renderTasksPanel());
  M.on('tasks:update', () => { if (M.state.activeTab === 'tasks') renderTasksPanel(); });
  M.on('snapshot:applied', () => { if (M.state.activeTab === 'tasks') renderTasksPanel(); });

  function renderTasksPanel() {
    const container = document.getElementById('tasksPanel');
    if (!container) return;
    const tasks = M.state.tasks || [];

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="panel-title" style="margin:0;">任务列表</div>
        <button class="btn-icon" id="btnNewTask" title="新建对话">${Icons.iconPlus}</button>
      </div>
      <div class="task-list" id="taskList">
        ${tasks.length === 0 ? '<div style="color:var(--text-faint);font-size:13px;padding:12px;text-align:center;">暂无任务</div>' : ''}
        ${tasks.map(t => `
          <div class="task-item ${t.id === M.state.currentTaskId ? 'active' : ''}" data-task-id="${t.id}">
            <span class="task-item-name">${M.escapeHtml(t.name || t.id)}</span>
            <span class="task-item-actions">
              <button class="btn-icon task-action-btn" data-action="rename" data-task-id="${t.id}" title="重命名" style="width:24px;height:24px;">${Icons.iconEdit}</button>
              <button class="btn-icon task-action-btn" data-action="delete" data-task-id="${t.id}" title="删除" style="width:24px;height:24px;">${Icons.iconTrash}</button>
            </span>
          </div>
        `).join('')}
      </div>
    `;

    bindTaskEvents();
  }

  function bindTaskEvents() {
    document.getElementById('btnNewTask')?.addEventListener('click', () => {
      M.createTask('新对话');
    });

    const taskList = document.getElementById('taskList');
    if (!taskList) return;

    // 任务项点击切换
    taskList.querySelectorAll('.task-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (renameTarget) return;
        // 如果点击的是操作按钮，不触发切换
        if (e.target.closest('.task-action-btn')) return;
        const taskId = item.dataset.taskId;
        if (taskId && taskId !== M.state.currentTaskId) {
          M.switchTask(taskId);
        }
      });
    });

    // 操作按钮单独绑定，避免事件委托失效
    taskList.querySelectorAll('.task-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const taskId = btn.dataset.taskId;
        if (action === 'delete') {
          if (confirm('确认删除此对话？')) M.deleteTask(taskId);
        } else if (action === 'rename') {
          const item = btn.closest('.task-item');
          if (item) startRename(taskId, item);
        }
      });
    });

    // 右键菜单
    taskList?.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.task-item');
      if (!item) return;
      e.preventDefault();
      startRename(item.dataset.taskId, item);
    });
  }

  function startRename(taskId, itemEl) {
    if (renameTarget) return;
    renameTarget = taskId;
    const nameEl = itemEl.querySelector('.task-item-name');
    const oldName = nameEl.textContent.trim();
    const input = document.createElement('input');
    input.className = 'task-item-rename';
    input.value = oldName;
    input.style.flex = '1';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        M.renameTask(taskId, newName);
      }
      renameTarget = null;
      renderTasksPanel();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renameTarget = null; renderTasksPanel(); }
    });
    input.addEventListener('blur', finish);
  }
})();