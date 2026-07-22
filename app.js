// app.js - 夏海·新纪元 · 远程控制 核心
// 状态机、WebSocket 客户端、路由、UI 框架

window.App = {
  // ===== 状态 =====
  state: {
    phase: 'pairing',        // pairing | connecting | connected | disconnected
    serverIp: '',
    serverPort: '8721',
    token: '',
    deviceName: '',
    connectionId: null,
    latency: 0,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    activeTab: 'chat',
    currentTaskId: null,
    tasks: [],
    messages: [],
    mcpServers: [],
    config: {},
    workDir: '',
    permissionMode: 'readonly',
    model: 'deepseek-v4-flash',
    streamEnabled: true,
    deepThinking: true,
    isGenerating: false,
    sidebarOpen: true,
    theme: 'dark',
    betaModels: [],
    customModels: []
  },

  // 事件系统（提前初始化，供模块脚本加载时立即注册）
  eventHandlers: {},

  // ===== 初始化 =====
  init() {
    this.ws = null;
    this.pingTimer = null;
    this.requestId = 0;
    this.pendingRequests = {};
    // eventHandlers 已在对象定义中初始化
    this.theme = localStorage.getItem('xh-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', this.theme);
    this.state.theme = this.theme;
    this.bindGlobalEvents();
    // 注册全局只应执行一次的事件监听器
    this.on('latency:update', () => this.updateConnectionUI());
    this.on('connection:lost', () => this.updateConnectionUI());
    // 检查是否有保存的 session，尝试自动重连
    const saved = this.loadSession();
    if (saved) {
      this.state.serverIp = saved.serverIp;
      this.state.serverPort = saved.serverPort;
      this.state.token = saved.token;
      this.state.deviceName = saved.deviceName || '';
      // 先显示配对页，再尝试自动重连
      this.showPairingPage();
      // 延迟一下再尝试连接，让配对页 DOM 先渲染
      setTimeout(() => {
        this.state.phase = 'connecting';
        this.connectWebSocket();
      }, 300);
    } else {
      this.showPairingPage();
    }
  },

  // ===== Session 持久化 =====
  saveSession() {
    const sess = {
      token: this.state.token,
      serverIp: this.state.serverIp,
      serverPort: this.state.serverPort,
      deviceName: this.state.deviceName
    };
    try { localStorage.setItem('xh-remote-session', JSON.stringify(sess)); } catch (_) {}
  },

  loadSession() {
    try {
      const raw = localStorage.getItem('xh-remote-session');
      if (!raw) return null;
      const sess = JSON.parse(raw);
      if (sess && sess.token && sess.serverIp) return sess;
    } catch (_) {}
    return null;
  },

  clearSession() {
    try { localStorage.removeItem('xh-remote-session'); } catch (_) {}
  },

  // ===== 全局事件 =====
  bindGlobalEvents() {
    window.addEventListener('beforeunload', () => this.disconnect());
  },

  // ===== 页面切换 =====
  showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const page = document.getElementById('page-' + name);
    if (page) page.classList.remove('hidden');
  },

  showPairingPage() {
    this.state.phase = 'pairing';
    this.showPage('pairing');
    this.renderPairingPage();
  },

  showMainPage() {
    this.state.phase = 'connected';
    this.showPage('main');
    this.renderMainUI();
    this.switchTab(this.state.activeTab);
  },

  // ===== 配对页渲染 =====
  renderPairingPage() {
    const page = document.getElementById('page-pairing');
    if (!page) return;
    // 注意：保持 .pairing-page 包裹层，让 CSS 的 flex 居中生效
    page.innerHTML = `
      <div class="pairing-page">
      <div class="pairing-card">
        <div class="pairing-header">
          <div class="pairing-logo-wrap">${Icons.iconWifi}</div>
          <div class="pairing-title">夏海·新纪元 · 远程控制</div>
          <div class="pairing-subtitle">连接到您的桌面端</div>
        </div>

        <div class="pairing-error" id="pairingError"></div>

        <div class="pairing-section">
          <div class="pairing-section-label">第一步：连接信息</div>
          <div class="pairing-row">
            <input class="input" id="pairingIp" placeholder="192.168.1.10" value="${this.state.serverIp}">
            <input class="input" id="pairingPort" placeholder="8721" value="${this.state.serverPort}" style="max-width:80px;">
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button class="btn-secondary" id="btnScan" style="flex:1;">
              ${Icons.iconSearch} 扫描局域网
            </button>
          </div>
          <div class="pairing-devices" id="pairingDevices"></div>
        </div>

        <div class="pairing-section">
          <div class="pairing-section-label">第二步：输入 6 位配对码</div>
          <div class="pairing-code-boxes" id="pairingCodeBoxes">
            ${Array.from({length:6},(_,i)=>`<input class="pairing-code-input" maxlength="1" data-index="${i}" type="text" inputmode="numeric" pattern="[0-9]">`).join('')}
          </div>
          <div class="pairing-hint">配对码请查看桌面端「设置 → 远程控制」，5 分钟内有效</div>
        </div>

        <div class="pairing-actions">
          <button class="btn-primary" id="btnConnect">
            ${Icons.iconLink} 连接
          </button>
          <span class="pairing-link" id="linkHowTo">如何获取配对码？</span>
        </div>
      </div>
      </div>
    `;
    this.bindPairingEvents();
  },

  bindPairingEvents() {
    const ip = document.getElementById('pairingIp');
    const port = document.getElementById('pairingPort');
    const codeBoxes = document.querySelectorAll('.pairing-code-input');
    const btnScan = document.getElementById('btnScan');
    const btnConnect = document.getElementById('btnConnect');

    // 配对码自动跳格
    codeBoxes.forEach((box, i) => {
      box.addEventListener('input', (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;
        if (val && i < 5) codeBoxes[i + 1].focus();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) codeBoxes[i - 1].focus();
        if (e.key === 'ArrowRight' && i < 5) codeBoxes[i + 1].focus();
        if (e.key === 'ArrowLeft' && i > 0) codeBoxes[i - 1].focus();
      });
      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '').slice(0, 6);
        paste.split('').forEach((c, j) => { if (codeBoxes[j]) codeBoxes[j].value = c; });
        const next = Math.min(paste.length, 5);
        if (codeBoxes[next]) codeBoxes[next].focus();
      });
    });

    btnScan?.addEventListener('click', () => this.scanLAN());
    btnConnect?.addEventListener('click', (e) => { e.preventDefault(); this.doConnect(); });

    // 如何获取配对码 帮助链接
    document.getElementById('linkHowTo')?.addEventListener('click', () => {
      this.showHowToModal();
    });

    // Enter 键连接 - 只在配对页可见时生效
    const onEnter = (e) => {
      if (e.key === 'Enter' && this.state.phase === 'pairing') {
        e.preventDefault();
        this.doConnect();
      }
    };
    // 先移除旧的同名监听器
    if (this._pairingEnterHandler) document.removeEventListener('keydown', this._pairingEnterHandler);
    this._pairingEnterHandler = onEnter;
    document.addEventListener('keydown', onEnter);
  },

  showHowToModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;">
        <div class="modal-header">
          <div class="modal-title">如何获取配对码？</div>
          <button class="btn-icon close-modal">${Icons.iconClose}</button>
        </div>
        <div class="modal-body" style="line-height:1.6;font-size:13px;">
          <ol style="padding-left:20px;color:var(--text-secondary);">
            <li>在桌面端夏海·新纪元中点击左上角菜单</li>
            <li>选择 <strong style="color:var(--accent);">设置</strong> → <strong style="color:var(--accent);">远程控制</strong></li>
            <li>点击"开启远程控制"，会显示一个 6 位数字配对码</li>
            <li>在此页面输入该配对码即可连接</li>
            <li>配对码 5 分钟内有效，过期需重新生成</li>
          </ol>
          <div style="margin-top:16px;padding:10px;background:var(--bg-subtle);border-radius:var(--radius-md);color:var(--text-faint);font-size:12px;">
            提示：手机和电脑需在同一个局域网下。如果配对失败，请检查电脑防火墙是否允许 8721 端口。
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-primary close-modal">知道了</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.close-modal')) overlay.remove();
    });
  },

  getPairingCode() {
    const boxes = document.querySelectorAll('.pairing-code-input');
    return Array.from(boxes).map(b => b.value).join('');
  },

  // ===== 局域网扫描 =====
  async scanLAN() {
    const ip = document.getElementById('pairingIp').value || '192.168.1.1';
    const port = document.getElementById('pairingPort').value || '8721';
    const devicesEl = document.getElementById('pairingDevices');
    devicesEl.innerHTML = '<div class="pairing-scanning"><div class="loading-spinner" style="width:16px;height:16px;"></div>正在扫描局域网中的设备...</div>';

    const base = ip.split('.').slice(0, 3).join('.');
    const found = [];
    const promises = [];
    for (let i = 1; i <= 254; i++) {
      promises.push(
        (async (host) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 800);
            const r = await fetch(`http://${host}:${port}/api/discover`, { signal: ctrl.signal });
            clearTimeout(t);
            if (r.ok) {
              const data = await r.json();
              if (data.type === 'xiahai-remote') found.push({ ip: host, name: data.name || host, port: data.port || port });
            }
          } catch (_) {}
        })(`${base}.${i}`)
      );
    }
    await Promise.allSettled(promises);

    if (found.length === 0) {
      devicesEl.innerHTML = '<div class="pairing-device-empty">未发现局域网中的夏海·新纪元，请确认桌面端已启动并开启远程控制</div>';
    } else {
      devicesEl.innerHTML = found.map(d => `
        <div class="pairing-device-item" data-ip="${d.ip}" data-port="${d.port}">
          ${Icons.iconDevice} <span class="pairing-device-ip">${d.name}</span> <span>${d.ip}:${d.port}</span>
        </div>
      `).join('');
      devicesEl.querySelectorAll('.pairing-device-item').forEach(item => {
        item.addEventListener('click', () => {
          document.getElementById('pairingIp').value = item.dataset.ip;
          document.getElementById('pairingPort').value = item.dataset.port;
        });
      });
    }
  },

  // ===== 连接 =====
  async doConnect() {
    const ip = document.getElementById('pairingIp').value.trim();
    const port = document.getElementById('pairingPort').value.trim() || '8721';
    const code = this.getPairingCode();
    const errorEl = document.getElementById('pairingError');

    if (!ip) { this.showPairingError('请输入 IP 地址'); return; }
    if (code.length !== 6) { this.showPairingError('请输入完整的 6 位配对码'); return; }

    this.state.serverIp = ip;
    this.state.serverPort = port;
    this.state.phase = 'connecting';

    const btn = document.getElementById('btnConnect');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;"></div> 连接中...';
    errorEl.style.display = 'none';

    try {
      const resp = await fetch(`http://${ip}:${port}/api/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceInfo: { name: navigator.userAgent, type: 'browser' } })
      });
      const data = await resp.json();
      if (!resp.ok || !data.token) {
        throw new Error(data.error || data.message || '配对失败');
      }
      this.state.token = data.token;
      this.state.deviceName = data.deviceName || ip;
      this.saveSession();
      this.connectWebSocket();
    } catch (e) {
      this.showPairingError(e.message || '连接失败');
      btn.disabled = false;
      btn.innerHTML = `${Icons.iconLink} 连接`;
      this.state.phase = 'pairing';
    }
  },

  showPairingError(msg) {
    const el = document.getElementById('pairingError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    const boxes = document.querySelectorAll('.pairing-code-input');
    boxes.forEach(b => b.classList.add('error'));
    setTimeout(() => boxes.forEach(b => b.classList.remove('error')), 500);
  },

  // ===== WebSocket =====
  connectWebSocket() {
    const { serverIp, serverPort, token } = this.state;
    if (!token) {
      this.showToast('请先完成配对', 'error');
      this.showPairingPage();
      return;
    }
    const wsUrl = `ws://${serverIp}:${serverPort}/ws?token=${encodeURIComponent(token)}`;
    console.log('[WS] 连接:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] 已连接');
      this.state.reconnectAttempts = 0;
      this.state.phase = 'connected';
      this.emit('connection:established');
      this.startPing();
      // 先请求一次完整快照（保证 task.list/mcp.list/chatHistory 等数据完整）
      this.requestFullSnapshot();
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleWSMessage(msg);
      } catch (err) {
        console.error('[WS] 解析消息失败:', err);
      }
    };

    this.ws.onclose = (e) => {
      console.log('[WS] 断开:', e.code, e.reason);
      this.stopPing();

      const reason = e.reason || '';
      const authReasons = ['kicked', 'unauthorized', 'auth-failed', 'server-stopped', 'invalid or expired token'];
      const isAuthClose = e.code === 1001 ||
        authReasons.some(r => reason.includes(r));
      const isRateLimit = e.code === 1008 && reason.includes('rate-limit');

      if (isAuthClose) {
        console.log('[WS] 认证失败/被踢出/服务停止，停止重连');
        this.clearSession();
        this.disconnect();
        this.showPairingPage();
        let errMsg = '连接已断开，请重新配对';
        if (isRateLimit) errMsg = '请求过于频繁，请稍后再试';
        if (reason.includes('kicked')) errMsg = '已被桌面端踢出，请重新配对';
        if (reason.includes('server-stopped')) errMsg = '桌面端服务已停止';
        this.showPairingError(errMsg);
        return;
      }

      this.tryReconnect();
    };

    this.ws.onerror = (e) => {
      console.error('[WS] 错误:', e);
    };
  },

  sendWS(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    msg.id = msg.id || ('req_' + Date.now() + '_' + (++this.requestId));
    msg.ts = Date.now();
    this.ws.send(JSON.stringify(msg));
    return msg.id;
  },

  handleWSMessage(msg) {
    const { type, event, method, payload, id, code, message } = msg;

    if (type === 'response' && id && this.pendingRequests[id]) {
      this.pendingRequests[id](payload);
      delete this.pendingRequests[id];
      return;
    }

    if (type === 'event' && event) {
      this.handleEvent(event, payload);
      return;
    }

    if (type === 'pong') {
      this._lastPongTs = Date.now();
      return;
    }

    if (type === 'error') {
      const errCode = code || (payload && payload.code);
      const errMsg = message || (payload && payload.message) || '未知错误';
      this.handleError({ code: errCode, message: errMsg });
    }
  },

  handleEvent(event, payload) {
    switch (event) {
      case 'app.ready':
        this.state.deviceName = payload.deviceName || this.state.deviceName;
        this.state.model = payload.model || this.state.model;
        this.state.workDir = payload.workDir || '';
        this.state.permissionMode = payload.permissionMode || 'readonly';
        this.state.deepThinking = payload.deepThinking !== false;
        this.state.streamEnabled = payload.streamEnabled !== false;
        // 同步任务列表和当前任务
        if (payload.tasks && Array.isArray(payload.tasks)) {
          this.state.tasks = payload.tasks;
        }
        if (payload.currentTaskId !== undefined) {
          this.state.currentTaskId = payload.currentTaskId;
        }
        // 同步 Beta/自定义模型列表
        this.state.betaModels = Array.isArray(payload.betaModels) ? payload.betaModels : [];
        this.state.customModels = Array.isArray(payload.customModels) ? payload.customModels : [];
        // 同步完整对话历史（多任务）
        if (payload.allChatHistory && typeof payload.allChatHistory === 'object') {
          this.state.allChatHistory = payload.allChatHistory;
          // 设置当前任务的 messages
          if (this.state.currentTaskId && this.state.allChatHistory[this.state.currentTaskId]) {
            this.state.messages = this.state.allChatHistory[this.state.currentTaskId];
          } else {
            // 否则找第一个有消息的任务
            const firstWithMsgs = Object.keys(this.state.allChatHistory).find(k =>
              this.state.allChatHistory[k] && this.state.allChatHistory[k].length > 0);
            if (firstWithMsgs) {
              this.state.currentTaskId = firstWithMsgs;
              this.state.messages = this.state.allChatHistory[firstWithMsgs];
            }
          }
        }
        // 显示主页面
        this.showMainPage();
        // 触发 UI 更新
        this.emit('tasks:update', this.state.tasks);
        this.emit('chat:message', { taskId: this.state.currentTaskId, sync: true });
        // 进入主页面后立即请求文件树、配置（防止 app.ready 中漏字段）
        this.requestInitialData();
        break;

      case 'state.snapshot':
        this.applySnapshot(payload);
        break;

      case 'state.patch':
        this.applyPatch(payload);
        break;

      case 'chat.done':
        this.handleChatDone(payload);
        break;

      case 'chat.regenerate':
        this.handleChatRegenerate(payload);
        break;

      case 'mcp.update':
        this.state.mcpServers = payload.servers || [];
        this.emit('mcp:update', this.state.mcpServers);
        break;

      case 'mcp.toolcall':
        this.handleToolCall(payload);
        break;

      case 'config.changed':
        // 配置变更（如 API Key），直接更新本地缓存并拉取完整配置
        if (payload && typeof payload === 'object') {
          this.state.config = { ...this.state.config, ...payload };
          this.emit('snapshot:applied');
        }
        this.refreshConfig();
        break;

      case 'file.changed':
        this.emit('file:changed', payload);
        break;

      case 'task.created':
        this.state.tasks.push(payload.task);
        this.emit('tasks:update', this.state.tasks);
        break;

      case 'task.deleted':
        this.state.tasks = this.state.tasks.filter(t => t.id !== payload.taskId);
        if (this.state.currentTaskId === payload.taskId) {
          this.state.currentTaskId = this.state.tasks[0]?.id || null;
        }
        this.emit('tasks:update', this.state.tasks);
        break;

      case 'task.switched':
        this.state.currentTaskId = payload.taskId;
        // 同步当前任务的消息列表
        if (this.state.allChatHistory && this.state.allChatHistory[payload.taskId]) {
          this.state.messages = this.state.allChatHistory[payload.taskId];
        } else {
          this.state.messages = [];
        }
        // 主动向服务端拉取一次该任务的完整历史，确保最新
        this.pullTaskHistory(payload.taskId);
        this.emit('task:switch', payload.taskId);
        break;

      case 'task.renamed':
        {
          const t = this.state.tasks.find(x => x.id === payload.taskId);
          if (t) t.name = payload.name;
          this.emit('tasks:update', this.state.tasks);
        }
        break;

      case 'folder.changed':
        this.state.workDir = payload.path;
        this.emit('folder:changed', payload.path);
        // 重新请求文件树
        if (payload.path) {
          this.sendWS({ type: 'request', method: 'folder.tree', payload: { path: payload.path, depth: 2 } });
        }
        break;

      case 'chat.message':
        // 收到新消息（来自其他客户端或本地），追加/替换到 messages
        {
          const tid = payload.taskId;
          if (!this.state.allChatHistory) this.state.allChatHistory = {};
          if (!this.state.allChatHistory[tid]) this.state.allChatHistory[tid] = [];
          if (payload.replace && Array.isArray(payload.messages)) {
            // 全量替换（如删除、中断后）
            this.state.allChatHistory[tid] = payload.messages;
          } else {
            // 防止重复：如果该位置已存在则覆盖
            const idx = payload.index ?? this.state.allChatHistory[tid].length;
            this.state.allChatHistory[tid][idx] = payload.message;
          }
          // 如果消息来自不同任务，自动切换到该任务（保持与桌面端同步）
          if (tid !== this.state.currentTaskId) {
            this.state.currentTaskId = tid;
            this.emit('task:switch', tid);
          }
          // 更新当前 messages
          this.state.messages = this.state.allChatHistory[tid];
          this.emit('chat:message', { taskId: tid, message: payload.message, index: payload.index });
        }
        break;

      case 'chat.chunk':
        // 增量更新助手消息
        {
          const tid = payload.taskId;
          if (!this.state.allChatHistory) this.state.allChatHistory = {};
          if (!this.state.allChatHistory[tid]) this.state.allChatHistory[tid] = [];
          let idx = payload.index;
          // 回退：如果 index 不是有效数字，查找最后一条 assistant 消息
          if (typeof idx !== 'number' || idx < 0) {
            const list = this.state.allChatHistory[tid];
            for (let i = list.length - 1; i >= 0; i--) {
              if (list[i] && list[i].role === 'assistant') { idx = i; break; }
            }
            if (typeof idx !== 'number' || idx < 0) {
              idx = list.length;
              list[idx] = { role: 'assistant', content: '', reasoning_content: '' };
            }
          }
          if (!this.state.allChatHistory[tid][idx]) this.state.allChatHistory[tid][idx] = { role: 'assistant', content: '', reasoning_content: '' };
          const a = this.state.allChatHistory[tid][idx];
          if (payload.reasoning_content) a.reasoning_content = (a.reasoning_content || '') + payload.reasoning_content;
          if (payload.content) a.content = (a.content || '') + payload.content;
          // 如果消息来自不同任务，自动切换到该任务（保持与桌面端同步）
          if (tid !== this.state.currentTaskId) {
            this.state.currentTaskId = tid;
            this.emit('task:switch', tid);
          }
          // 更新当前 messages
          this.state.messages = this.state.allChatHistory[tid];
          this.emit('chat:chunk', { taskId: tid, index: idx, content: a.content, reasoning: a.reasoning_content });
        }
        break;

      case 'chat.aborted':
        {
          const tid = payload.taskId;
          if (this.state.allChatHistory && this.state.allChatHistory[tid]) {
            // 已移除占位
          }
        }
        break;

      case 'chat.error':
        this.showToast('对话错误：' + (payload.error || '未知错误'), 'error');
        break;

      case 'mcp.updated':
        this.state.mcpServers = payload.servers || [];
        this.emit('mcp:update', this.state.mcpServers);
        break;

      case 'model.changed':
        this.state.model = payload.model;
        this.emit('model:changed', payload.model);
        break;

      case 'models.changed':
        if (payload.betaModels) this.state.betaModels = payload.betaModels;
        if (payload.customModels) this.state.customModels = payload.customModels;
        this.emit('models:changed');
        break;

      case 'permission.changed':
        this.state.permissionMode = payload.mode;
        this.emit('permission:changed', payload.mode);
        break;

      case 'stream.changed':
        this.state.streamEnabled = payload.enabled;
        this.emit('stream:changed', payload.enabled);
        break;

      case 'client.connected':
      case 'client.disconnected':
        this.emit(event, payload);
        break;

      case 'toast':
        this.showToast(payload.message, payload.level);
        break;

      case 'kicked':
        this.showToast('已被桌面端踢出：' + (payload.reason || '管理员操作'), 'error');
        // 注意：被踢出时不要发送 client.going-offline（避免混淆）
        this.stopPing();
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
        if (this.ws) {
          try { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(1000, 'kicked'); } catch (_) {}
          this.ws = null;
        }
        this.state.phase = 'disconnected';
        this.state.token = '';
        this.state.reconnectAttempts = 0;
        this.showPairingPage();
        this.showPairingError('您已被桌面端踢出');
        break;
    }
  },

  handleError(err) {
    const { code, message } = err || {};
    const msg = message || '未知错误';
    const authErrorCodes = [1001, 1002, 1003, 'invalid-token', 'token-expired', 'unauthorized'];
    const isAuthError = authErrorCodes.includes(code) || msg.includes('token') || msg.includes('认证') || msg.includes('授权');
    const isRateLimit = code === 1008 || msg.includes('rate-limit') || msg.includes('频率');

    if (isAuthError) {
      this.showToast(msg + '，请重新配对', 'error');
      this.clearSession();
      this.stopPing();
      if (this.ws) { try { this.ws.close(1000, 'auth-failed'); } catch (_) {} }
      this.disconnect();
      this.showPairingPage();
      this.showPairingError(msg);
    } else if (isRateLimit) {
      this.showToast('请求过于频繁，请稍后再试', 'warning');
    } else {
      this.showToast(msg, 'error');
    }
  },

  // ===== 快照同步 =====
  applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.tasks) this.state.tasks = snapshot.tasks;
    if (snapshot.currentTaskId !== undefined) this.state.currentTaskId = snapshot.currentTaskId;
    if (snapshot.mcpServers) this.state.mcpServers = snapshot.mcpServers;
    if (snapshot.model) this.state.model = snapshot.model;
    if (snapshot.workDir !== undefined) this.state.workDir = snapshot.workDir;
    if (snapshot.permissionMode) this.state.permissionMode = snapshot.permissionMode;
    if (snapshot.streamEnabled !== undefined) this.state.streamEnabled = snapshot.streamEnabled;
    if (snapshot.deepThinking !== undefined) this.state.deepThinking = snapshot.deepThinking;
    if (snapshot.config) this.state.config = snapshot.config;
    if (snapshot.betaModels) this.state.betaModels = snapshot.betaModels;
    if (snapshot.customModels) this.state.customModels = snapshot.customModels;
    // 兼容两种字段：allChatHistory（来自 app.ready）和 chatHistory（来自 state.get）
    const historySource = snapshot.allChatHistory || snapshot.chatHistory;
    if (historySource) {
      this.state.allChatHistory = historySource;
      // 合并历史：当前任务的历史写入 messages
      if (this.state.currentTaskId && historySource[this.state.currentTaskId]) {
        this.state.messages = historySource[this.state.currentTaskId] || [];
      } else {
        // 否则使用第一条有消息的任务
        const firstTaskWithMessages = Object.keys(historySource).find(k => historySource[k] && historySource[k].length > 0);
        if (firstTaskWithMessages) {
          this.state.currentTaskId = firstTaskWithMessages;
          this.state.messages = historySource[firstTaskWithMessages];
        }
      }
    }
    this.emit('snapshot:applied');
    // 触发各 UI 模块更新
    this.emit('tasks:update', this.state.tasks);
    this.emit('mcp:update', this.state.mcpServers);
    // 通知 chat 模块用新的 messages 重新渲染
    this.emit('chat:message', { taskId: this.state.currentTaskId, sync: true });
  },

  applyPatch(patch) {
    const { path, value, op } = patch;
    const keys = path.split('.');
    let obj = this.state;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    if (op === 'delete') delete obj[keys[keys.length - 1]];
    else obj[keys[keys.length - 1]] = value;
    this.emit('state:patch', patch);
  },

  requestSnapshot() {
    this.sendWS({ type: 'request', method: 'state.get' });
  },

  // 进入主页面后请求初始数据
  requestInitialData() {
    // 请求任务列表（直接处理响应）
    const id1 = this.sendWS({ type: 'request', method: 'task.list' });
    if (id1) {
      this.pendingRequests[id1] = (payload) => {
        const data = payload && payload.data;
        if (data && data.tasks) {
          this.state.tasks = data.tasks;
          this.emit('tasks:update', this.state.tasks);
        }
      };
    }
    // 请求 MCP 列表
    const id2 = this.sendWS({ type: 'request', method: 'mcp.list' });
    if (id2) {
      this.pendingRequests[id2] = (payload) => {
        const data = payload && payload.data;
        if (data && Array.isArray(data)) {
          this.state.mcpServers = data;
          this.emit('mcp:update', this.state.mcpServers);
        }
      };
    }
    // 请求配置
    const id3 = this.sendWS({ type: 'request', method: 'config.get' });
    if (id3) {
      this.pendingRequests[id3] = (payload) => {
        const data = payload && payload.data;
        if (data) {
          this.state.config = data;
          if (data.betaModels) this.state.betaModels = data.betaModels;
          if (data.customModels) this.state.customModels = data.customModels;
          this.emit('snapshot:applied');
        }
      };
    }
    // 如果有工作目录，请求文件树
    if (this.state.workDir) {
      this.sendWS({ type: 'request', method: 'folder.tree', payload: { path: this.state.workDir, depth: 2 } });
    }
  },

  // 在连接后立即拉取完整快照（保证数据最新）
  requestFullSnapshot() {
    const id = this.sendWS({ type: 'request', method: 'state.get' });
    if (id) {
      this.pendingRequests[id] = (payload) => {
        const data = payload && payload.data;
        if (data) {
          this.applySnapshot(data);
        }
      };
    }
  },

  // 主动拉取指定任务的完整历史
  pullTaskHistory(taskId) {
    if (!taskId) return;
    const id = this.sendWS({ type: 'request', method: 'task.history', payload: { taskId } });
    if (id) {
      this.pendingRequests[id] = (payload) => {
        const data = payload && payload.data;
        if (data && Array.isArray(data.messages)) {
          if (!this.state.allChatHistory) this.state.allChatHistory = {};
          this.state.allChatHistory[taskId] = data.messages;
          if (taskId === this.state.currentTaskId) {
            this.state.messages = data.messages;
            this.emit('chat:message', { taskId, sync: true });
          }
        }
      };
    }
  },

  // ===== 心跳 =====
  startPing() {
    this.stopPing();
    this._missedPings = 0;
    this._lastPongTs = Date.now();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const start = Date.now();
      const id = this.sendWS({ type: 'request', method: 'app.ping' });
      if (id) {
        this.pendingRequests[id] = () => {
          this._missedPings = 0;
          this._lastPongTs = Date.now();
          this.state.latency = Date.now() - start;
          this.emit('latency:update', this.state.latency);
        };
      }

      this._missedPings++;
      if (this._missedPings >= 3) {
        console.warn('[WS] 连续 3 次心跳无响应，判定连接已断开');
        this.stopPing();
        if (this.ws) {
          try { this.ws.close(1000, 'ping-timeout'); } catch (_) {}
        }
      }
    }, 5000);
  },

  stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this._missedPings = 0;
  },

  // ===== 重连 =====
  tryReconnect() {
    if (this.state.phase === 'pairing') return;
    if (this.state.reconnectAttempts >= this.state.maxReconnectAttempts) {
      this.state.phase = 'disconnected';
      this.showToast('多次重连失败，请检查网络或重新配对', 'error');
      this.emit('connection:lost');
      return;
    }
    this.state.phase = 'connecting';
    this.state.reconnectAttempts++;
    const attempt = this.state.reconnectAttempts;
    const baseDelay = 1000;
    const jitter = Math.random() * 500;
    const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1) + jitter, 30000);
    console.log(`[WS] ${(delay / 1000).toFixed(1)}s 后第 ${attempt} 次重连 (最多 ${this.state.maxReconnectAttempts} 次)`);
    this.showToast(`连接断开，${(delay / 1000).toFixed(0)}s 后第 ${attempt} 次重连...`, 'warning');
    this._reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
  },

  disconnect() {
    this.stopPing();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      // 在关闭前主动通知服务端（"client.going-offline" 事件）
      // 这样服务端可以立刻更新设备列表，无需等待 ws close 事件
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'event', event: 'client.going-offline', payload: { reason: 'client-disconnect' } }));
        }
      } catch (_) {}
      try { this.ws.close(1000, 'client-disconnect'); } catch (_) {}
      this.ws = null;
    }
    this.state.phase = 'disconnected';
    this.state.token = '';
    this.state.reconnectAttempts = 0;
  },

  // ===== 对话处理 =====
  handleChatMessage(payload) {
    const { taskId, message, index } = payload;
    if (taskId === this.state.currentTaskId || !taskId) {
      if (index !== undefined) {
        this.state.messages[index] = message;
      } else {
        this.state.messages.push(message);
      }
    }
    this.emit('chat:message', payload);
  },

  handleChatChunk(payload) {
    this.emit('chat:chunk', payload);
  },

  handleChatDone(payload) {
    this.state.isGenerating = false;
    this.emit('chat:done', payload);
  },

  handleChatError(payload) {
    this.state.isGenerating = false;
    this.emit('chat:error', payload);
  },

  handleChatRegenerate(payload) {
    this.emit('chat:regenerate', payload);
  },

  handleToolCall(payload) {
    this.emit('mcp:toolcall', payload);
  },

  // ===== 发送消息 =====
  sendMessage(text, attachments) {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (this.state.isGenerating) return;
    this.state.isGenerating = true;
    this.sendWS({
      type: 'request',
      method: 'chat.send',
      payload: {
        taskId: this.state.currentTaskId,
        text,
        attachments: attachments || [],
        useDeepThink: this.state.deepThinking,
        streamEnabled: this.state.streamEnabled,
        permissionMode: this.state.permissionMode
      }
    });
  },

  stopGenerating() {
    if (!this.state.isGenerating) return;
    this.sendWS({ type: 'request', method: 'chat.stop', payload: { taskId: this.state.currentTaskId } });
    this.state.isGenerating = false;
  },

  // ===== 任务管理 =====
  createTask(name) {
    this.sendWS({ type: 'request', method: 'task.create', payload: { name: name || '新对话' } });
  },

  deleteTask(taskId) {
    this.sendWS({ type: 'request', method: 'task.delete', payload: { taskId } });
  },

  switchTask(taskId) {
    const switchId = this.sendWS({ type: 'request', method: 'task.switch', payload: { taskId } });
    this.state.currentTaskId = taskId;
    if (switchId) {
      this.pendingRequests[switchId] = () => {
        this.state.currentTaskId = taskId;
        if (this.state.allChatHistory && this.state.allChatHistory[taskId]) {
          this.state.messages = this.state.allChatHistory[taskId];
        } else {
          this.state.messages = [];
        }
        this.emit('task:switch', taskId);
      };
    }
    const histId = this.sendWS({ type: 'request', method: 'task.history', payload: { taskId } });
    if (histId) {
      this.pendingRequests[histId] = (payload) => {
        const data = payload && payload.data;
        if (data && Array.isArray(data.messages)) {
          if (!this.state.allChatHistory) this.state.allChatHistory = {};
          this.state.allChatHistory[taskId] = data.messages;
          this.state.messages = data.messages;
          this.emit('chat:message', { taskId, sync: true });
        }
      };
    }
  },

  renameTask(taskId, name) {
    this.sendWS({ type: 'request', method: 'task.rename', payload: { taskId, name } });
  },

  // ===== MCP 管理 =====
  requestMcpList() {
    this.sendWS({ type: 'request', method: 'mcp.list' });
  },

  addMcpServer(config) {
    this.sendWS({ type: 'request', method: 'mcp.add', payload: config });
  },

  removeMcpServer(serverId) {
    this.sendWS({ type: 'request', method: 'mcp.remove', payload: { serverId } });
  },

  toggleMcpServer(serverId, enabled) {
    this.sendWS({ type: 'request', method: 'mcp.toggle', payload: { serverId, enabled } });
  },

  restartMcpServer(serverId) {
    this.sendWS({ type: 'request', method: 'mcp.restart', payload: { serverId } });
  },

  callMcpTool(serverId, toolName, args) {
    this.sendWS({ type: 'request', method: 'mcp.callTool', payload: { serverId, toolName, args } });
  },

  // ===== 配置管理 =====
  requestConfig() {
    this.sendWS({ type: 'request', method: 'config.get' });
  },

  refreshConfig() {
    const id = this.sendWS({ type: 'request', method: 'config.get' });
    if (id) {
      this.pendingRequests[id] = (payload) => {
        const data = payload && payload.data;
        if (data) {
          this.state.config = data;
          if (data.betaModels) this.state.betaModels = data.betaModels;
          if (data.customModels) this.state.customModels = data.customModels;
          this.emit('snapshot:applied');
          this.showToast('配置已同步', 'success');
        }
      };
    }
  },

  updateConfig(patches) {
    this.sendWS({ type: 'request', method: 'config.update', payload: { patches } });
  },

  updateApiKey(apiKey) {
    this.sendWS({ type: 'request', method: 'config.apikey.update', payload: { apiKey } });
  },

  testApiKey() {
    const id = this.sendWS({ type: 'request', method: 'config.apikey.test' });
    if (id) {
      this.pendingRequests[id] = (payload) => {
        const statusEl = document.getElementById('apiKeyStatus');
        if (!statusEl) return;
        statusEl.classList.remove('hidden');
        if (payload && payload.ok) {
          statusEl.textContent = '测试通过';
          statusEl.className = 'settings-status success';
        } else {
          statusEl.textContent = '测试失败: ' + (payload?.message || payload?.error || '未知错误');
          statusEl.className = 'settings-status error';
        }
      };
    }
  },

  setModel(model) {
    this.sendWS({ type: 'request', method: 'config.model.set', payload: { model } });
  },

  setPermission(mode) {
    this.sendWS({ type: 'request', method: 'config.permission.set', payload: { mode } });
  },

  setStream(enabled) {
    this.sendWS({ type: 'request', method: 'config.stream.set', payload: { enabled } });
  },

  // ===== 文件操作 =====
  openFolderDialog() {
    const id = this.sendWS({ type: 'request', method: 'folder.openDialog' });
    if (id) {
      this.pendingRequests[id] = (payload) => {
        const data = payload && payload.data;
        if (data && data.path) {
          this.state.workDir = data.path;
          this.emit('folder:changed', data.path);
        }
      };
    }
  },

  requestFileTree(path) {
    this.sendWS({ type: 'request', method: 'folder.tree', payload: { path } });
  },

  requestFileChildren(path) {
    this.sendWS({ type: 'request', method: 'folder.children', payload: { path } });
  },

  readFile(path) {
    this.sendWS({ type: 'request', method: 'folder.read', payload: { path } });
  },

  writeFile(path, content) {
    this.sendWS({ type: 'request', method: 'folder.write', payload: { path, content } });
  },

  deleteFile(path) {
    this.sendWS({ type: 'request', method: 'folder.delete', payload: { path } });
  },

  openFolderDialog() {
    this.sendWS({ type: 'request', method: 'folder.openDialog' });
  },

  setFolder(path) {
    this.sendWS({ type: 'request', method: 'folder.set', payload: { path } });
  },

  uploadFile(path, base64Content) {
    this.sendWS({ type: 'request', method: 'folder.upload', payload: { path, content: base64Content } });
  },

  // ===== 事件系统 =====
  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  },

  off(event, handler) {
    if (!this.eventHandlers[event]) return;
    this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
  },

  emit(event, data) {
    if (!this.eventHandlers[event]) return;
    this.eventHandlers[event].forEach(h => {
      try { h(data); } catch (e) { console.error('[Event]', event, e); }
    });
  },

  // ===== Tab 切换 =====
  switchTab(tab) {
    this.state.activeTab = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.remove('hidden');

    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tab);
    });

    switch (tab) {
      case 'chat': this.emit('tab:chat'); break;
      case 'tasks': this.emit('tab:tasks'); break;
      case 'mcp': this.requestMcpList(); this.emit('tab:mcp'); break;
      case 'folder': this.emit('tab:folder'); break;
      case 'settings': this.requestConfig(); this.emit('tab:settings'); break;
    }
  },

  // ===== Toast =====
  showToast(message, level) {
    level = level || 'info';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { info: Icons.iconInfo, success: Icons.iconCheck, error: Icons.iconAlert, warning: Icons.iconAlert };
    const toast = document.createElement('div');
    toast.className = 'toast ' + level;
    toast.innerHTML = `${icons[level] || ''} ${this.escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ===== 工具函数 =====
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  },

  formatTime(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    return Math.floor(seconds / 3600) + 'h';
  },

  // ===== 渲染主界面 =====
  renderMainUI() {
    const page = document.getElementById('page-main');
    if (!page) return;
    page.innerHTML = `
      <header class="titlebar">
        <div class="titlebar-left">
          <button class="titlebar-toggle" id="btnToggleSidebar">${Icons.iconMenu}</button>
          <span class="titlebar-text">夏海·新纪元 · 远程</span>
          <span class="titlebar-tag" id="deviceTag">${this.state.deviceName}</span>
        </div>
        <div class="titlebar-center">
          <div class="connection-status" id="connectionStatus">
            <span class="status-dot" id="statusDot"></span>
            <span class="status-latency" id="statusLatency">--</span>
          </div>
        </div>
        <div class="titlebar-right">
          <button class="titlebar-btn" id="btnTheme" title="切换主题">${Icons.iconTheme}</button>
          <button class="titlebar-btn" id="btnDisconnect" title="断开连接">${Icons.iconUnlink}</button>
        </div>
      </header>

      <div class="main-container">
        <nav class="sidebar" id="sidebar">
          <div class="sidebar-nav">
            <button class="sidebar-nav-item active" data-tab="chat">${Icons.iconChat} 对话</button>
            <button class="sidebar-nav-item" data-tab="tasks">${Icons.iconTask} 任务</button>
            <button class="sidebar-nav-item" data-tab="mcp">${Icons.iconMcp} MCP</button>
            <button class="sidebar-nav-item" data-tab="folder">${Icons.iconFolder} 文件</button>
            <button class="sidebar-nav-item" data-tab="settings">${Icons.iconSettings} 设置</button>
          </div>
        </nav>

        <div class="content-panel">
          <div class="tab-panel" id="tab-chat"></div>
          <div class="tab-panel hidden" id="tab-tasks"><div class="panel-body" id="tasksPanel"></div></div>
          <div class="tab-panel hidden" id="tab-mcp"><div class="panel-body" id="mcpPanel"></div></div>
          <div class="tab-panel hidden" id="tab-folder">
            <div class="file-layout" id="fileLayout"></div>
          </div>
          <div class="tab-panel hidden" id="tab-settings"><div class="panel-body" id="settingsPanel"></div></div>
        </div>
      </div>
    `;

    this.bindMainEvents();
    // 注意：latency:update / connection:lost 在 init() 中只注册一次，不在此处重复
    this.updateConnectionUI();
  },

  bindMainEvents() {
    document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
      this.state.sidebarOpen = !this.state.sidebarOpen;
      document.getElementById('sidebar').classList.toggle('collapsed', !this.state.sidebarOpen);
    });

    document.getElementById('btnTheme')?.addEventListener('click', () => {
      this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.state.theme);
      localStorage.setItem('xh-theme', this.state.theme);
    });

    document.getElementById('btnDisconnect')?.addEventListener('click', () => {
      this.clearSession();
      this.disconnect();
      this.showPairingPage();
    });

    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.addEventListener('click', () => this.switchTab(item.dataset.tab));
    });
  },

  updateConnectionUI() {
    const dot = document.getElementById('statusDot');
    const latency = document.getElementById('statusLatency');
    if (!dot) return;
    dot.className = 'status-dot';
    if (this.state.phase === 'connected') {
      if (this.state.latency > 200) dot.classList.add('warning');
    } else if (this.state.phase === 'connecting') {
      dot.classList.add('warning');
    } else {
      dot.classList.add('error');
    }
    if (latency) latency.textContent = this.state.phase === 'connected' ? this.state.latency + 'ms' : '--';
  }
};

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', () => App.init());