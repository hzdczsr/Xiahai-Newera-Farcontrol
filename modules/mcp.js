// mcp.js - MCP Server 管理模块
// MCP 服务器列表、添加、启停、重启

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  M.on('tab:mcp', () => renderMcpPanel());
  M.on('mcp:update', () => { if (M.state.activeTab === 'mcp') renderMcpPanel(); });
  M.on('snapshot:applied', () => { if (M.state.activeTab === 'mcp') renderMcpPanel(); });

  function renderMcpPanel() {
    const container = document.getElementById('mcpPanel');
    if (!container) return;
    const servers = M.state.mcpServers || [];

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div class="panel-title" style="margin:0;">MCP Server 管理</div>
        <button class="btn-primary" id="btnAddMcp" style="padding:6px 14px;font-size:12px;">
          ${Icons.iconPlus} 添加
        </button>
      </div>
      ${servers.length === 0 ? `
        <div class="mcp-empty">
          ${Icons.iconMcp}
          <div>暂无 MCP Server</div>
          <div style="font-size:12px;">点击"添加"按钮连接 MCP Server</div>
        </div>
      ` : `
        <div class="mcp-grid" id="mcpGrid">
          ${servers.map(s => renderMcpCard(s)).join('')}
        </div>
      `}
    `;

    bindMcpEvents();
  }

  function renderMcpCard(server) {
    const statusClass = server.status === 'connected' ? 'connected' : (server.status === 'connecting' ? 'connecting' : 'stopped');
    return `
      <div class="mcp-card" data-server-id="${server.id}">
        <div class="mcp-card-header">
          <div class="mcp-card-name">
            <span class="mcp-status-dot ${statusClass}"></span>
            ${M.escapeHtml(server.name || server.id)}
          </div>
          <div class="mcp-card-actions">
            <button class="toggle ${server.enabled ? 'on' : ''}" data-action="toggle" data-server-id="${server.id}"></button>
            <button class="btn-icon" data-action="restart" data-server-id="${server.id}" title="重启" style="width:28px;height:28px;">${Icons.iconRefresh}</button>
            <button class="btn-icon" data-action="remove" data-server-id="${server.id}" title="删除" style="width:28px;height:28px;">${Icons.iconTrash}</button>
          </div>
        </div>
        <div class="mcp-card-body">
          ${server.command ? `<div class="mcp-card-detail"><span class="mcp-card-detail-label">命令</span><code>${M.escapeHtml(server.command)}</code></div>` : ''}
          ${server.args ? `<div class="mcp-card-detail"><span class="mcp-card-detail-label">参数</span><code>${M.escapeHtml(server.args.join(' '))}</code></div>` : ''}
          ${server.tools ? `<div class="mcp-card-detail"><span class="mcp-card-detail-label">工具</span>${server.tools.length} 个</div>` : ''}
          ${server.error ? `<div class="mcp-card-detail" style="color:var(--danger);">${M.escapeHtml(server.error)}</div>` : ''}
        </div>
      </div>
    `;
  }

  function bindMcpEvents() {
    document.getElementById('btnAddMcp')?.addEventListener('click', showAddMcpModal);

    document.getElementById('mcpGrid')?.addEventListener('click', (e) => {
      const toggle = e.target.closest('.toggle');
      const btn = e.target.closest('.btn-icon');
      const serverId = toggle?.dataset.serverId || btn?.dataset.serverId;
      const action = toggle?.dataset.action || btn?.dataset.action;
      if (!serverId || !action) return;

      if (action === 'toggle') {
        const s = M.state.mcpServers.find(s => s.id === serverId);
        if (s) M.toggleMcpServer(serverId, !s.enabled);
      } else if (action === 'restart') {
        M.restartMcpServer(serverId);
      } else if (action === 'remove') {
        if (confirm('确认删除此 MCP Server？')) M.removeMcpServer(serverId);
      }
    });
  }

  function showAddMcpModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">添加 MCP Server</div>
          <button class="btn-icon close-modal">${Icons.iconClose}</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">名称</div>
              <input class="input" id="mcpName" placeholder="My MCP Server">
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">命令</div>
              <input class="input" id="mcpCommand" placeholder="npx">
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">参数（空格分隔）</div>
              <input class="input" id="mcpArgs" placeholder="-y @modelcontextprotocol/server-filesystem">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary close-modal">取消</button>
          <button class="btn-primary" id="btnConfirmAdd">添加</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.close-modal')) overlay.remove();
    });

    document.getElementById('btnConfirmAdd')?.addEventListener('click', () => {
      const name = document.getElementById('mcpName').value.trim();
      const command = document.getElementById('mcpCommand').value.trim();
      const args = document.getElementById('mcpArgs').value.trim().split(/\s+/).filter(Boolean);
      if (!command) { M.showToast('请输入命令', 'error'); return; }
      M.addMcpServer({ name: name || command, command, args });
      overlay.remove();
      M.showToast('MCP Server 已添加', 'success');
    });
  }
})();