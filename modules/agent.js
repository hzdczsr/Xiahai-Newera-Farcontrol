// agent.js - Agent 模块

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  M.state.agents = M.state.agents || [];
  M.state.agentReviewQueue = M.state.agentReviewQueue || [];
  M.state.agentMaxAgents = M.state.agentMaxAgents || 4;

  M.on('tab:agent', () => {
    M.requestAgentList();
    renderAgentPanel();
  });
  M.on('agent:update', () => { if (M.state.activeTab === 'agent') renderAgentPanel(); });
  M.on('agent:log', () => { if (M.state.activeTab === 'agent') refreshAgentLog(); });
  M.on('snapshot:applied', () => { if (M.state.activeTab === 'agent') renderAgentPanel(); });

  function renderAgentPanel() {
    const container = document.getElementById('agentPanel');
    if (!container) return;

    const agents = M.state.agents || [];
    const runningCount = agents.filter(a => a.status === 'running').length;
    const maxAgents = M.state.agentMaxAgents || 4;

    container.innerHTML = `
      <div class="agent-panel-header">
        <div class="agent-panel-title">
          ${Icons.iconAgent}
          <span>Agent / Builder</span>
          <span class="agent-panel-count">${runningCount}/${maxAgents}</span>
        </div>
        <button class="btn-icon" id="btnNewAgent" title="新建 Agent">${Icons.iconPlus}</button>
      </div>
      <div class="agent-list" id="agentList">
        ${agents.length === 0 ? '<div class="agent-empty">暂无 Agent，点击右上角 + 创建</div>' : ''}
        ${agents.map(agent => renderAgentCard(agent)).join('')}
      </div>
      ${renderReviewQueueSection()}
      <div class="agent-log-panel" id="agentLogPanel" hidden>
        <div class="agent-log-header">
          <span id="agentLogTitle">运行日志</span>
          <button class="btn-icon" id="btnCloseAgentLog">${Icons.iconClose}</button>
        </div>
        <pre class="agent-log-content" id="agentLogContent"></pre>
      </div>
    `;

    bindAgentEvents();
  }

  function renderAgentCard(agent) {
    const statusMap = {
      idle: { text: '已暂停', cls: 'idle' },
      running: { text: '运行中', cls: 'running' },
      waiting: { text: '排队中', cls: 'waiting' },
      completed: { text: '已完成', cls: 'completed' },
      error: { text: '已终止', cls: 'error' }
    };
    const s = statusMap[agent.status] || { text: agent.status, cls: 'idle' };
    const showProgress = agent.status === 'running' || agent.status === 'waiting';

    const actionButtons = [];
    if (agent.status === 'running') {
      actionButtons.push(`<button class="agent-action-btn pause" data-action="pause" data-agent-id="${agent.id}">暂停</button>`);
      actionButtons.push(`<button class="agent-action-btn stop" data-action="stop" data-agent-id="${agent.id}">终止</button>`);
    } else if (agent.status === 'idle' || agent.status === 'waiting') {
      actionButtons.push(`<button class="agent-action-btn resume" data-action="resume" data-agent-id="${agent.id}">继续</button>`);
      actionButtons.push(`<button class="agent-action-btn stop" data-action="stop" data-agent-id="${agent.id}">终止</button>`);
    } else {
      actionButtons.push(`<button class="agent-action-btn remove" data-action="remove" data-agent-id="${agent.id}">移除</button>`);
    }

    return `
      <div class="agent-card ${agent.status === 'running' ? 'active' : ''}" data-agent-id="${agent.id}">
        <div class="agent-card-main">
          <div class="agent-card-info">
            <div class="agent-card-status-dot ${s.cls}"></div>
            <div class="agent-card-meta">
              <div class="agent-card-name">${M.escapeHtml(agent.name || agent.id)}</div>
              <div class="agent-card-task">${M.escapeHtml(agent.task || '')}</div>
            </div>
          </div>
          <span class="agent-card-status ${s.cls}">${s.text}</span>
        </div>
        ${showProgress ? `
        <div class="agent-card-progress">
          <div class="agent-progress-track">
            <div class="agent-progress-fill ${agent.status === 'running' && (agent.progress || 0) < 10 ? 'indeterminate' : ''}" style="width:${agent.progress || 0}%"></div>
          </div>
          <span class="agent-progress-text">${agent.progress || 0}%</span>
        </div>` : ''}
        <div class="agent-card-actions">
          ${actionButtons.join('')}
          <button class="agent-action-btn log" data-action="log" data-agent-id="${agent.id}">日志</button>
        </div>
      </div>
    `;
  }

  function renderReviewQueueSection() {
    const queue = M.state.agentReviewQueue || [];
    const pending = queue.filter(r => r.status === 'pending');
    if (pending.length === 0) return '';
    return `
      <div class="agent-review-section">
        <div class="agent-review-header">审查队列 <span class="agent-review-count">${pending.length}</span></div>
        <div class="agent-review-list">
          ${pending.map(item => `
            <div class="agent-review-item" data-review-id="${item.id}">
              <div class="agent-review-info">
                <div class="agent-review-file">${M.escapeHtml(item.file || '')}</div>
                <div class="agent-review-summary">来自 ${M.escapeHtml(item.agentName || '')}: ${M.escapeHtml(item.summary || '')}</div>
              </div>
              <div class="agent-review-actions">
                <button class="agent-review-btn approve" data-action="approve" data-review-id="${item.id}">${Icons.iconCheck}</button>
                <button class="agent-review-btn reject" data-action="reject" data-review-id="${item.id}">${Icons.iconClose}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function bindAgentEvents() {
    document.getElementById('btnNewAgent')?.addEventListener('click', () => {
      showCreateAgentDialog();
    });

    document.getElementById('btnCloseAgentLog')?.addEventListener('click', () => {
      const panel = document.getElementById('agentLogPanel');
      if (panel) panel.hidden = true;
    });

    document.getElementById('agentList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.agent-action-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const agentId = btn.dataset.agentId;
      if (!agentId) return;

      if (action === 'pause') M.pauseAgent(agentId);
      else if (action === 'resume') M.resumeAgent(agentId);
      else if (action === 'stop') M.stopAgent(agentId);
      else if (action === 'remove') M.removeAgent(agentId);
      else if (action === 'log') showAgentLog(agentId);
    });

    document.querySelector('.agent-review-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.agent-review-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const reviewId = btn.dataset.reviewId;
      const item = (M.state.agentReviewQueue || []).find(r => r.id === reviewId);
      if (item) {
        item.status = action === 'approve' ? 'approved' : 'rejected';
        if (typeof M.reviewAgentOperation === 'function') {
          M.reviewAgentOperation(reviewId, action === 'approve');
        }
        M.emit('agent:update');
      }
    });
  }

  function showAgentLog(agentId) {
    const agent = (M.state.agents || []).find(a => a.id === agentId);
    if (!agent) return;
    const panel = document.getElementById('agentLogPanel');
    const title = document.getElementById('agentLogTitle');
    const content = document.getElementById('agentLogContent');
    if (!panel || !content) return;
    title.textContent = (agent.name || agent.id) + ' 运行日志';
    title.dataset.agentId = agentId;
    content.textContent = agent.output || '暂无日志';
    panel.hidden = false;
  }

  function refreshAgentLog() {
    const panel = document.getElementById('agentLogPanel');
    const content = document.getElementById('agentLogContent');
    if (!panel || panel.hidden || !content) return;
    const title = document.getElementById('agentLogTitle');
    const agentId = title && title.dataset ? title.dataset.agentId : null;
    if (!agentId) return;
    const agent = (M.state.agents || []).find(a => a.id === agentId);
    if (agent && content.textContent !== (agent.output || '')) {
      content.textContent = agent.output || '暂无日志';
      content.scrollTop = content.scrollHeight;
    }
  }

  function showCreateAgentDialog() {
    let dialog = document.getElementById('agentCreateDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.className = 'agent-create-dialog';
      dialog.id = 'agentCreateDialog';
      document.body.appendChild(dialog);
    }
    dialog.hidden = false;
    dialog.innerHTML = `
      <div class="agent-create-card">
        <h3>新建 Agent</h3>
        <div class="agent-create-field">
          <label>名称</label>
          <input type="text" id="agentCreateName" placeholder="例如：代码助手" maxlength="30">
        </div>
        <div class="agent-create-field">
          <label>任务描述</label>
          <textarea id="agentCreateTask" placeholder="描述需要 Agent 独立完成的任务..." rows="3"></textarea>
        </div>
        <div class="agent-create-field">
          <label>模式</label>
          <select id="agentCreateMode">
            <option value="auto">自动 — 自主决策并执行</option>
            <option value="review">审查 — 生成操作后等待确认</option>
            <option value="report">报告 — 仅分析并报告</option>
          </select>
        </div>
        <div class="agent-create-actions">
          <button class="btn-secondary" id="btnAgentCreateCancel">取消</button>
          <button class="btn-primary" id="btnAgentCreateConfirm">创建</button>
        </div>
      </div>
    `;

    document.getElementById('btnAgentCreateCancel')?.addEventListener('click', () => {
      dialog.hidden = true;
    });
    document.getElementById('btnAgentCreateConfirm')?.addEventListener('click', () => {
      const name = document.getElementById('agentCreateName').value.trim();
      const task = document.getElementById('agentCreateTask').value.trim();
      const mode = document.getElementById('agentCreateMode').value;
      if (!task) {
        M.showToast('请输入任务描述', 'error');
        return;
      }
      M.createAgent(name || 'Agent', task, mode);
      dialog.hidden = true;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.hidden = true;
    });
  }
})();
