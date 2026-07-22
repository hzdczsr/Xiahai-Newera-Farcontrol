// config.js - 设置面板模块
// API Key、模型、权限、远程控制设置

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  M.on('tab:settings', () => renderSettingsPanel());
  M.on('snapshot:applied', () => { if (M.state.activeTab === 'settings') renderSettingsPanel(); });
  M.on('model:changed', () => { if (M.state.activeTab === 'settings') renderSettingsPanel(); });
  M.on('models:changed', () => { if (M.state.activeTab === 'settings') renderSettingsPanel(); });
  M.on('permission:changed', () => { if (M.state.activeTab === 'settings') renderSettingsPanel(); });
  M.on('stream:changed', () => { if (M.state.activeTab === 'settings') renderSettingsPanel(); });

  function renderModelOptions(currentModel) {
    const builtIn = [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
    ];
    const beta = (M.state.betaModels || []).map(m => ({ id: m.id, name: m.fullName || m.name || m.id, badge: m.badge || 'Beta' }));
    const custom = (M.state.customModels || []).map(m => ({ id: m.id, name: m.fullName || m.name || m.modelId || m.id, badge: '自定义' }));
    const all = [...builtIn, ...beta, ...custom];
    return all.map(m => {
      const label = m.badge ? `${m.name} [${m.badge}]` : m.name;
      return `<option value="${M.escapeHtml(m.id)}" ${currentModel === m.id ? 'selected' : ''}>${M.escapeHtml(label)}</option>`;
    }).join('');
  }

  function renderSettingsPanel() {
    const container = document.getElementById('settingsPanel');
    if (!container) return;
    const config = M.state.config || {};

    container.innerHTML = `
      <div class="panel-title" style="margin-bottom:20px;">设置</div>

      <div class="settings-section">
        <div class="settings-section-title">API Key</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">DeepSeek API Key</div>
            <div class="settings-desc">用于 AI 对话和深度思考（请在软件端设置）</div>
          </div>
          <div class="settings-input-group">
            <input class="input" id="apiKeyInput" type="text" readonly placeholder="未设置" value="${config.apiKeySet && config.apiKeyHint ? config.apiKeyHint : (config.apiKeySet ? '已设置' : '未设置')}">
            <button class="btn-secondary" id="btnRefreshApiKey" title="从软件端同步" style="white-space:nowrap;">刷新</button>
            <button class="btn-secondary" id="btnTestApiKey" style="white-space:nowrap;">测试</button>
            <span class="settings-status hidden" id="apiKeyStatus"></span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">模型</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">当前模型</div>
            <div class="settings-desc">切换 AI 对话模型</div>
          </div>
          <select class="input" id="settingsModelSelect" style="width:auto;min-width:200px;">
            ${renderModelOptions(M.state.model)}
          </select>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">权限</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">默认权限模式</div>
            <div class="settings-desc">远程控制时的文
件操作权限</div>
          </div>
          <div class="permission-switch" id="settingsPermission" style="border-radius:var(--radius-pill);">
            <button class="permission-btn ${M.state.permissionMode === 'readonly' ? 'active' : ''}" data-mode="readonly">
              ${Icons.iconEye} 只读
            </button>
            <button class="permission-btn ${M.state.permissionMode === 'full' ? 'active' : ''}" data-mode="full">
              ${Icons.iconPower} 完全
            </button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">对话</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">流式输出</div>
            <div class="settings-desc">实时显示 AI 生成内容</div>
          </div>
          <button class="toggle ${M.state.streamEnabled ? 'on' : ''}" id="settingsStreamToggle"></button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">深度思考</div>
            <div class="settings-desc">始终启用深度思考模式</div>
          </div>
          <span style="color:var(--success);font-size:12px;font-weight:500;">已启用</span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">远程控制</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">连接状态</div>
            <div class="settings-desc">${M.state.phase === 'connected' ? `已连接到 ${M.state.deviceName}` : '未连接'}</div>
          </div>
          <span class="status-dot ${M.state.phase === 'connected' ? '' : 'error'}"></span>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">延迟</div>
          </div>
          <span style="font-family:var(--font-mono);font-size:13px;">${M.state.phase === 'connected' ? M.state.latency + 'ms' : '--'}</span>
        </div>
        <div class="settings-row">
          <div></div>
          <button class="btn-danger" id="btnDisconnectSettings">断开连接</button>
        </div>
      </div>
    `;

    bindSettingsEvents();
  }

  function bindSettingsEvents() {
    document.getElementById('btnRefreshApiKey')?.addEventListener('click', () => {
      M.refreshConfig();
    });

    document.getElementById('btnTestApiKey')?.addEventListener('click', () => {
      M.testApiKey();
      const status = document.getElementById('apiKeyStatus');
      if (status) { status.classList.remove('hidden'); status.className = 'settings-status'; status.textContent = '测试中...'; }
    });

    document.getElementById('settingsModelSelect')?.addEventListener('change', (e) => {
      M.setModel(e.target.value);
    });

    document.getElementById('settingsPermission')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.permission-btn');
      if (!btn) return;
      M.setPermission(btn.dataset.mode);
    });

    document.getElementById('settingsStreamToggle')?.addEventListener('click', () => {
      M.setStream(!M.state.streamEnabled);
    });

    document.getElementById('btnDisconnectSettings')?.addEventListener('click', () => {
      M.disconnect();
      M.showPairingPage();
    });
  }

  // 监听 API Key 测试结果
  M.on('state:patch', (patch) => {
    if (M.state.activeTab === 'settings' && patch.path?.startsWith('config')) {
      renderSettingsPanel();
    }
  });
})();