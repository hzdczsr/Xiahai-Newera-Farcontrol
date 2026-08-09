// Main Application Controller - 统一控制端
(function() {
  'use strict';

  // ==================== 全局状态 ====================
  const state = {
    connected: false,
    reconnecting: false,
    deviceName: '未知设备',
    deviceModel: '',
    osVersion: '',
    batteryLevel: null,
    isConnected: false,
    permissionMode: 'full',
    model: localStorage.getItem('selectedModel') || 'deepseek-v4-flash',
    streamEnabled: localStorage.getItem('streamEnabled') === 'true',
    webSearchEnabled: localStorage.getItem('webSearchEnabled') === 'true',
    isGenerating: false,
    currentTaskId: null,
    currentTaskName: '',
    tasks: [],
    messages: [],
    allChatHistory: {},
    activeTab: 'tasks',
    betaModels: [],
    customModels: [],
    agents: [],
    agentReviewQueue: [],
    agentMaxAgents: 4,
    pendingRequests: {},
    globalLog: [],
    logMaxSize: 500,
    isMobile: false,
    sidebarCollapsed: false,
    showWelcome: false,
  };

  // 事件总线
  const eventBus = new Map();
  window.App = { state, eventBus };

  // ==================== WebSocket ====================
  let ws = null;
  let requestCounter = 0;

  function connectWebSocket() {
    if (ws && ws.readyState <= 1) return;
    state.reconnecting = true;
    updateConnectionStatus('connecting');

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.connected = true;
      state.reconnecting = false;
      updateConnectionStatus('connected');
      emit('connect');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) {
        console.error('解析消息失败:', e);
      }
    };

    ws.onclose = () => {
      state.connected = false;
      ws = null;
      updateConnectionStatus('disconnected');
      // 自动重连
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      if (ws) ws.close();
    };
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'device_info':
        Object.assign(state, data.payload);
        emit('device:update');
        break;
      case 'task_update':
        handleTaskUpdate(data.payload);
        break;
      case 'chat':
        handleChatMessage(data.payload);
        break;
      case 'agent':
        handleAgentUpdate(data.payload);
        break;
      case 'permission_change':
        state.permissionMode = data.payload.mode;
        emit('permission:changed');
        break;
      case 'snapshot':
        handleSnapshot(data.payload);
        break;
      case 'model_change':
        state.model = data.payload.model;
        localStorage.setItem('selectedModel', state.model);
        emit('model:changed');
        break;
      case 'stream_chunk':
        emit('chat:chunk', data.payload);
        break;
      case 'stream_done':
        emit('chat:done', data.payload);
        break;
      case 'stream_error':
        emit('chat:error', data.payload);
        break;
      default:
        if (data.type === 'request_response') {
          const req = state.pendingRequests[data.id];
          if (req) {
            clearTimeout(req.timer);
            req.resolve(data.payload);
            delete state.pendingRequests[data.id];
          }
        }
        break;
    }
  }

  function handleTaskUpdate(payload) {
    const task = state.tasks.find(t => t.id === payload.id);
    if (task) {
      Object.assign(task, payload);
    } else {
      state.tasks.push({ ...payload, steps: payload.steps || [] });
    }
    if (state.currentTaskId === payload.id) {
      state.messages = payload.messages || [];
    }
    emit('task:update');
  }

  function handleChatMessage(payload) {
    if (state.currentTaskId === payload.taskId) {
      state.messages.push(payload);
    }
    emit('chat:message', payload);
  }

  function handleAgentUpdate(payload) {
    switch (payload.action) {
      case 'create':
        state.agents.push(payload.agent);
        break;
      case 'update':
        const idx = state.agents.findIndex(a => a.id === payload.agent.id);
        if (idx >= 0) state.agents[idx] = payload.agent;
        break;
      case 'remove':
        state.agents = state.agents.filter(a => a.id !== payload.id);
        break;
      case 'log':
        (state.agents.find(a => a.id === payload.agentId) || {}).output = (payload.agent.output || '') + payload.log + '\n';
        break;
      case 'review_queue':
        state.agentReviewQueue = payload.queue;
        break;
    }
    emit('agent:update');
  }

  function handleSnapshot(payload) {
    state.currentTaskId = payload.taskId;
    state.messages = payload.messages || [];
    emit('snapshot:applied');
  }

  // ==================== 请求封装 ====================
  function sendWS(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket 未连接');
      return null;
    }
    const id = ++requestCounter;
    const req = { id, ...data };
    const timer = setTimeout(() => {
      delete state.pendingRequests[id];
      console.error('请求超时:', id);
    }, 60000);
    state.pendingRequests[id] = {
      resolve: (payload) => {
        clearTimeout(timer);
        return payload;
      }
    };
    ws.send(JSON.stringify(req));
    return id;
  }

  // ==================== 公共 API ====================
  window.App = {
    state,
    emit,
    sendWS,
    connectWebSocket,
    sendMessage(text, attachments = []) {
      if (!text.trim() && attachments.length === 0) return;
      const payload = {
        type: 'chat',
        payload: { text: text.trim(), attachments, taskId: state.currentTaskId }
      };
      sendWS(payload);
      // 乐观更新
      state.messages.push({ role: 'user', content: text.trim(), timestamp: new Date().toISOString() });
      emit('chat:message', payload.payload);
    },
    stopGenerating() {
      sendWS({ type: 'chat:stop' });
      state.isGenerating = false;
      emit('chat:stop');
    },
    createTask(name) {
      const id = 'task_' + Date.now();
      const task = { id, name, status: 'idle', steps: [], messages: [] };
      state.tasks.push(task);
      state.currentTaskId = id;
      state.currentTaskName = name;
      emit('task:create', task);
      sendWS({ type: 'task:create', payload: { name, id } });
    },
    switchTask(taskId) {
      state.currentTaskId = taskId;
      const task = state.tasks.find(t => t.id === taskId);
      if (task) {
        state.currentTaskName = task.name;
        state.messages = task.messages || [];
      }
      emit('task:switch', taskId);
    },
    deleteTask(taskId) {
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      if (state.currentTaskId === taskId) {
        state.currentTaskId = state.tasks[0]?.id || null;
        state.messages = [];
      }
      emit('task:delete', taskId);
    },
    setPermission(mode) {
      state.permissionMode = mode;
      sendWS({ type: 'permission:set', payload: { mode } });
    },
    setModel(modelId) {
      state.model = modelId;
      localStorage.setItem('selectedModel', modelId);
      sendWS({ type: 'model:set', payload: { model: modelId } });
      emit('model:changed', modelId);
    },
    setStream(enabled) {
      state.streamEnabled = enabled;
      localStorage.setItem('streamEnabled', enabled);
      sendWS({ type: 'stream:set', payload: { enabled } });
      emit('stream:changed', enabled);
    },
    setWebSearch(enabled) {
      state.webSearchEnabled = enabled;
      localStorage.setItem('webSearchEnabled', enabled);
      sendWS({ type: 'websearch:set', payload: { enabled } });
      emit('websearch:changed', enabled);
    },
    // Agent 相关
    createAgent(name, task, mode) {
      const id = 'agent_' + Date.now();
      const agent = { id, name, task, mode, status: 'idle', progress: 0, output: '' };
      state.agents.push(agent);
      sendWS({ type: 'agent:create', payload: { id, name, task, mode } });
      emit('agent:update');
    },
    pauseAgent(agentId) {
      sendWS({ type: 'agent:pause', payload: { agentId } });
    },
    resumeAgent(agentId) {
      sendWS({ type: 'agent:resume', payload: { agentId } });
    },
    stopAgent(agentId) {
      sendWS({ type: 'agent:stop', payload: { agentId } });
    },
    removeAgent(agentId) {
      state.agents = state.agents.filter(a => a.id !== agentId);
      sendWS({ type: 'agent:remove', payload: { agentId } });
      emit('agent:update');
    },
    reviewAgentOperation(reviewId, approved) {
      sendWS({ type: 'agent:review', payload: { reviewId, approved } });
    },
    // 工具函数
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    formatBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },
    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    },
    showContextMenu(options) {
      // 简化的上下文菜单
      console.log('Context menu:', options);
    },
    openSettings() {
      this.emit('open:settings');
    }
  };

  // ==================== 事件系统 ====================
  function on(event, callback) {
    if (!eventBus.has(event)) eventBus.set(event, []);
    eventBus.get(event).push(callback);
  }

  function emit(event, payload) {
    const callbacks = eventBus.get(event) || [];
    callbacks.forEach(cb => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`事件 ${event} 处理出错:`, e);
      }
    });
  }

  window.App.on = on;

  // ==================== 初始化 ====================
  function init() {
    // 加载自定义模型
    try {
      const custom = localStorage.getItem('customModels');
      if (custom) state.customModels = JSON.parse(custom);
    } catch (e) { console.error('加载自定义模型失败:', e); }

    // 连接WebSocket
    connectWebSocket();

    // 定期刷新设备信息
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendWS({ type: 'device:ping' });
      }
    }, 30000);

    // 通知渲染进程App已初始化
    if (window.ipcRenderer) {
      window.ipcRenderer.send('app-ready');
    }

    console.log('夏海·新纪元 统一控制端 v2.0 已启动');
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
