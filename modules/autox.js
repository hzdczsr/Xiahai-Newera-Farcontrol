// AutoX 远程控制面板（运行管理 + VC++ 运行库）
// 不含远程鼠标键盘与聊天/截屏，仅提供本地模型部署、服务运行、安装目录管理与 VC++ 运行库维护。
(function () {
  const M = window.App;
  if (!M) return;

  let panel = null;

  let state = {
    install: null,      // autox.getInstallDir 返回
    vc: null,           // autox.getVcRedistStatus 返回
    busy: false,        // 是否有长操作进行中
  };

  // ===== 请求封装 =====
  function req(method, payload) {
    return new Promise((resolve, reject) => {
      const id = M.sendWS({ type: 'request', method, payload });
      if (!id) { reject(new Error('未连接到远程服务')); return; }
      const timer = setTimeout(() => {
        delete M.pendingRequests[id];
        reject(new Error('请求超时')); a }, 180000);
      M.pendingRequests[id] = (resp) => {
        clearTimeout(timer);
        if (resp && resp.ok) resolve(resp.data);
        else reject(new Error((resp && (resp.message || resp.error)) || '请求失败'));
      };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===== 进度日志 =====
  function logLine(text, level) {
    const box = panel && panel.querySelector('#autox-log');
    if (!box) return;
    const line = document.createElement('div');
    line.className = 'autox-log-line' + (level ? ' autox-log-' + level : '');
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    line.textContent = '[' + t + '] ' + text;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  // ===== 主渲染 =====
  async function render() {
    panel = document.getElementById('autoxPanel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-header">
          <h2>AutoX 运行管理</h2>
          <div class="panel-header-actions">
            <span id="autox-run-dot" class="status-dot status-unknown"></span>
            <span id="autox-run-text">状态未知</span>
            <button class="btn" id="autox-refresh">刷新</button>
          </div>
        </div>
        <div id="autox-loading" class="autox-loading">正在加载 AutoX 状态…</div>
        <div id="autox-body" style="display:none"></div>
      </div>

      <div class="panel-section">
        <h3>VC++ 运行库</h3>
        <div id="autox-vc" class="autox-vc"></div>
      </div>

      <div class="panel-section">
        <h3>操作日志</h3>
        <div id="autox-log" class="autox-log"></div>
      </div>
    `;

    panel.querySelector('#autox-refresh').addEventListener('click', loadAll);

    await loadAll();
  }

  async function loadAll() {
    await Promise.allSettled([loadInstall(), loadVc()]);
    renderBody();
  }

  async function loadInstall() {
    try {
      const data = await req('autox.getInstallDir', {});
      state.install = data;
    } catch (e) {
      state.install = null;
      logLine('加载安装信息失败: ' + e.message, 'error');
    }
  }

  async function loadVc() {
    try {
      const data = await req('autox.getVcRedistStatus', {});
      state.vc = data;
    } catch (e) {
      state.vc = null;
      logLine('加载 VC++ 状态失败: ' + e.message, 'error');
    }
  }

  function renderBody() {
    const body = panel.querySelector('#autox-body');
    const loading = panel.querySelector('#autox-loading');
    if (!body) return;

    const install = state.install;
    if (!install) {
      loading.style.display = 'none';
      body.style.display = 'block';
      body.innerHTML = '<div class="autox-error">无法获取 AutoX 信息，请确认桌面端已开启远程控制且 AutoX 引擎可用。</div>';
      updateRunDot(false, '不可用');
      return;
    }

    loading.style.display = 'none';
    body.style.display = 'block';

    const di = install.deployInfo || {};
    const isRunning = !!install.isRunning;
    updateRunDot(isRunning, isRunning ? ('运行中 :' + (install.port || '?')) : '已停止');

    const vc = state.vc || {};
    const vcText = vc.installed ? '已安装' : (vc.exists ? '已下载未安装' : '未下载');

    body.innerHTML = `
      <div class="form-row">
        <label>安装目录</label>
        <div class="form-value">
          <code>${esc(install.autoxDir || '-')}</code>
          <button class="btn btn-small" id="autox-open-dir">打开目录</button>
          <button class="btn btn-small" id="autox-set-dir">修改目录</button>
        </div>
      </div>
      <div class="form-row">
        <label>模型文件 (.gguf)</label>
        <div class="form-value">
          <span class="status-dot ${di.modelDeployed ? 'status-ok' : 'status-bad'}"></span>
          ${di.modelDeployed ? '已部署' : '未部署'}
          <code>${esc(di.modelPath || '')}</code>
        </div>
      </div>
      <div class="form-row">
        <label>推理引擎 (llama-server)</label>
        <div class="form-value">
          <span class="status-dot ${di.exeOk ? 'status-ok' : 'status-bad'}"></span>
          ${di.exeOk ? '已就绪' : '缺失'}
          <code>${esc(di.exePath || '')}</code>
        </div>
      </div>
      <div class="form-row">
        <label>运行库目录</label>
        <div class="form-value">
          <span class="status-dot ${di.runtimeDeployed ? 'status-ok' : 'status-bad'}"></span>
          ${di.runtimeDeployed ? '已部署' : '未部署'}
          <code>${esc(install.runtimeDir || '')}</code>
        </div>
      </div>

      <div class="autox-actions">
        <button class="btn btn-primary" id="autox-deploy">${di.status === 'ready' ? '重新部署' : '部署本地模型'}</button>
        <button class="btn ${isRunning ? '' : 'btn-primary'}" id="autox-start" ${isRunning ? 'disabled' : ''}>启动服务</button>
        <button class="btn" id="autox-stop" ${isRunning ? '' : 'disabled'}>停止服务</button>
        <button class="btn btn-danger" id="autox-delete">删除全部组件</button>
      </div>

      <div class="autox-start-opts">
        <span>启动端口</span>
        <input type="number" id="autox-port" value="${install.port || 8080}" min="1" max="65535" class="autox-input" />
      </div>
    `;

    // VC 区块
    const vcBox = panel.querySelector('#autox-vc');
    vcBox.innerHTML = `
      <div class="form-row">
        <label>VC++ 运行库 (x64)</label>
        <div class="form-value">
          <span class="status-dot ${vc.installed ? 'status-ok' : (vc.exists ? 'status-warn' : 'status-bad')}"></span>
          ${esc(vcText)}
          <code>${esc(vc.path || '')}</code>
        </div>
      </div>
      <div class="autox-actions">
        <button class="btn" id="autox-vc-download" ${vc.installed || vc.exists ? 'disabled' : ''}>下载 VC++</button>
        <button class="btn btn-primary" id="autox-vc-install" ${vc.installed || !vc.exists ? 'disabled' : ''}>安装 VC++</button>
        <button class="btn btn-danger" id="autox-vc-delete" ${vc.exists ? '' : 'disabled'}>删除 VC++</button>
      </div>
    `;

    bindActions(isRunning, vc);
  }

  function updateRunDot(ok, text) {
    const dot = panel.querySelector('#autox-run-dot');
    const label = panel.querySelector('#autox-run-text');
    if (dot) {
      dot.className = 'status-dot ' + (text === '不可用' ? 'status-unknown' : (ok ? 'status-ok' : 'status-bad'));
    }
    if (label) label.textContent = text;
  }

  function bindActions(isRunning, vc) {
    const $ = (id) => panel.querySelector('#' + id);
    const guard = (fn) => async (e) => {
      if (state.busy) { M.showToast && M.showToast('请等待当前操作完成'); return; }
      state.busy = true;
      e.target.disabled = true;
      try { await fn(); } finally { state.busy = false; await loadAll(); }
    };

    $('autox-open-dir').addEventListener('click', guard(async () => {
      const r = await req('autox.openInstallDir', {});
      if (!r.success) M.showToast && M.showToast(r.message || '打开失败');
    }));

    $('autox-set-dir').addEventListener('click', async () => {
      const cur = state.install ? state.install.rootDir : '';
      const dir = prompt('请输入新的 AutoX 安装根目录：', cur);
      if (!dir) return;
      const r = await req('autox.setInstallDir', { dir });
      if (r.success) { M.showToast && M.showToast('已更新安装目录'); }
      else M.showToast && M.showToast(r.message || '更新失败');
      await loadAll();
    });

    $('autox-deploy').addEventListener('click', guard(async () => {
      logLine('开始部署本地模型…');
      const r = await req('autox.deploy', {});
      logLine(r.message || ('部署结果: ' + r.success), r.success ? 'ok' : 'error');
      M.showToast && M.showToast(r.message || (r.success ? '部署完成' : '部署失败'));
    }));

    const startBtn = $('autox-start');
    if (startBtn) startBtn.addEventListener('click', guard(async () => {
      const port = parseInt(panel.querySelector('#autox-port').value, 10) || 8080;
      logLine('正在启动本地模型服务 (端口 ' + port + ')…');
      const r = await req('autox.startServer', { options: { port } });
      logLine(r.message || ('启动结果: ' + r.success), r.success ? 'ok' : 'error');
      M.showToast && M.showToast(r.message || (r.success ? '已启动' : '启动失败'));
    }));

    const stopBtn = $('autox-stop');
    if (stopBtn) stopBtn.addEventListener('click', guard(async () => {
      const r = await req('autox.stopServer', {});
      logLine(r.message || '已停止', 'ok');
    }));

    $('autox-delete').addEventListener('click', guard(async () => {
      if (!confirm('确定删除 AutoX 的全部组件（模型/运行库）？此操作不可恢复。')) return;
      const r = await req('autox.deleteAllComponents', {});
      logLine(r.message || ('删除结果: ' + r.success), r.success ? 'ok' : 'error');
      M.showToast && M.showToast(r.message || (r.success ? '已删除' : '删除失败'));
    }));

    // VC 操作
    $('autox-vc-download').addEventListener('click', guard(async () => {
      logLine('开始下载 VC++ 运行库…');
      const r = await req('autox.downloadVcRedist', {});
      logLine(r.message || ('下载结果: ' + r.success), r.success ? 'ok' : 'error');
      M.showToast && M.showToast(r.message || (r.success ? '下载完成' : '下载失败'));
    }));

    $('autox-vc-install').addEventListener('click', guard(async () => {
      logLine('正在安装 VC++ 运行库…');
      const r = await req('autox.installVcRedist', {});
      logLine(r.message || ('安装结果: ' + r.success), r.success ? 'ok' : 'error');
      M.showToast && M.showToast(r.message || (r.success ? '安装完成' : '安装失败'));
    }));

    $('autox-vc-delete').addEventListener('click', guard(async () => {
      if (!confirm('确定删除已下载的 VC++ 运行库安装包？')) return;
      const r = await req('autox.deleteVcRedist', {});
      logLine(r.message || '已删除', 'ok');
      M.showToast && M.showToast(r.message || (r.success ? '已删除' : '删除失败'));
    }));
  }

  // ===== 进度事件 =====
  M.on('event:autox.progress', (payload) => {
    if (!payload) return;
    const icons = { checking: '🔍', downloading: '⬇️', ready: '✅', error: '❌', done: '✅', restarting: '🔄' };
    const icon = icons[payload.status] || '•';
    logLine(icon + ' ' + (payload.step || '') + ': ' + (payload.message || ''), payload.status === 'error' ? 'error' : '');
  });
  M.on('event:autox.log', (payload) => {
    if (!payload || !payload.message) return;
    logLine(payload.message, payload.level === 'error' ? 'error' : (payload.level === 'warn' ? 'warn' : ''));
  });

  M.on('tab:autox', render);
  M.on('connect', () => { if (M.state.activeTab === 'autox') render(); });
})();
