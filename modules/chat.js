// chat.js - 对话面板模块
// 聊天消息渲染、输入框、流式更新、Markdown 渲染

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  let chatRendered = false;
  let streamingMessageId = null;
  let streamingContent = '';
  let streamingReasoning = '';

  M.on('tab:chat', () => {
    renderChatPanel();
    // 请求当前任务的历史消息并更新 UI
    if (M.state.currentTaskId) {
      const id = M.sendWS({ type: 'request', method: 'task.history', payload: { taskId: M.state.currentTaskId } });
      if (id) {
        M.pendingRequests[id] = (payload) => {
          const data = payload && payload.data;
          if (data && Array.isArray(data.messages)) {
            if (!M.state.allChatHistory) M.state.allChatHistory = {};
            M.state.allChatHistory[M.state.currentTaskId] = data.messages;
            M.state.messages = data.messages;
            renderChatPanel();
          }
        };
      }
    }
  });

  M.on('snapshot:applied', () => {
    if (M.state.activeTab === 'chat') renderChatPanel();
  });

  M.on('chat:message', (payload) => {
    if (M.state.activeTab === 'chat') {
      // 流式期间跳过全量重渲染，避免销毁流式气泡
      if (streamingMessageId) return;
      renderChatPanel();
    }
  });

  M.on('chat:chunk', (payload) => {
    if (M.state.activeTab === 'chat') {
      if (!streamingMessageId) {
        streamingMessageId = 'stream_' + Date.now();
        streamingContent = '';
        streamingReasoning = '';
        addStreamingMessage();
      }
      if (payload.reasoning) streamingReasoning = (streamingReasoning || '') + payload.reasoning;
      if (payload.content) streamingContent += payload.content;
      updateStreamingMessage();
    }
  });

  // 确保流式气泡存在（如果 chat:chunk 到达时不存在则创建）
  function ensureStreamingBubble() {
    if (!streamingMessageId) {
      streamingMessageId = 'stream_' + Date.now();
      streamingContent = '';
      streamingReasoning = '';
      addStreamingMessage();
    }
  }

  M.on('chat:done', (payload) => {
    if (streamingMessageId) {
      finalizeStreamingMessage(payload);
    }
    streamingMessageId = null;
    streamingContent = '';
    streamingReasoning = '';
    if (M.state.activeTab === 'chat') renderChatPanel();
  });

  // 确保 chat:done 总是能清理流式状态
  function cleanupStreamingState() {
    streamingMessageId = null;
    streamingContent = '';
    streamingReasoning = '';
  }

  M.on('chat:error', (payload) => {
    if (streamingMessageId) {
      const el = document.getElementById(streamingMessageId);
      if (el) {
        const bubble = el.querySelector('.message-bubble');
        if (bubble) bubble.innerHTML = `<span style="color:var(--danger);">发生错误: ${M.escapeHtml(payload.error || '未知错误')}</span>`;
      }
    }
    streamingMessageId = null;
    streamingContent = '';
    streamingReasoning = '';
    M.state.isGenerating = false;
  });

  M.on('chat:regenerate', (payload) => {
    if (M.state.activeTab === 'chat') renderChatPanel();
  });

  M.on('task:switch', () => {
    if (M.state.activeTab === 'chat') renderChatPanel();
  });

  M.on('model:changed', () => {
    if (chatRendered) updateModelSelect();
  });

  M.on('models:changed', () => {
    if (chatRendered) renderChatPanel();
  });

  M.on('permission:changed', () => {
    if (chatRendered) updatePermissionSwitch();
  });

  M.on('stream:changed', () => {
    if (chatRendered) updateStreamToggle();
  });

  function getModelDisplayName(modelId) {
    if (!modelId) return '';
    const builtInMap = {
      'deepseek-v4-flash': 'DeepSeek V4 Flash'
    };
    if (builtInMap[modelId]) return builtInMap[modelId];
    const beta = (M.state.betaModels || []).find(m => m.id === modelId);
    if (beta) return beta.fullName || beta.name || modelId;
    const custom = (M.state.customModels || []).find(m => m.id === modelId);
    if (custom) return custom.fullName || custom.name || custom.modelId || modelId;
    return modelId;
  }

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

  function renderChatPanel() {
    chatRendered = false;
    const container = document.getElementById('tab-chat');
    if (!container) return;

    const messages = M.state.messages || [];
    const hasMessages = messages.length > 0;

    container.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">对话</div>
        <div class="panel-title">${M.state.deviceName || ''}</div>
      </div>
      <div class="chat-subtoolbar" id="chatSubToolbar">
        <div class="chat-task-name" id="chatTaskName">
          ${M.state.currentTaskId ? (M.state.tasks.find(t => t.id === M.state.currentTaskId)?.name || '对话') : '新对话'}
        </div>
        <div class="permission-switch" id="permissionSwitch">
          <button class="permission-btn ${M.state.permissionMode === 'readonly' ? 'active' : ''}" data-mode="readonly">${Icons.iconEye} 只读</button>
          <button class="permission-btn ${M.state.permissionMode === 'full' ? 'active' : ''}" data-mode="full">${Icons.iconPower} 完全</button>
        </div>
        <select class="model-select" id="modelSelect">
          ${renderModelOptions(M.state.model)}
        </select>
        <button class="stream-toggle ${M.state.streamEnabled ? 'active' : ''}" id="streamToggle">
          ${Icons.iconPlay} 流式
        </button>
      </div>
      <div class="chat-messages" id="chatMessages">
        ${hasMessages ? renderMessages(messages) : `
          <div class="chat-empty">
            ${Icons.iconChat}
            <div class="chat-empty-text">还没有消息，开始对话吧</div>
          </div>
        `}
      </div>
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <div class="chat-input-toolbar" id="chatInputToolbar">
            <button class="btn-icon" id="btnUploadFile" title="上传文件">${Icons.iconUpload}</button>
            <button class="btn-icon" id="btnUploadImage" title="上传图片">${Icons.iconImage}</button>
            <span class="toolbar-pill" id="toolbarCreate">${Icons.iconCode} Create</span>
            <span class="toolbar-pill" id="toolbarWrite">${Icons.iconPencil} Write</span>
            <div id="attachmentTags" style="display:flex;gap:4px;flex-wrap:wrap;"></div>
          </div>
          <div class="chat-input-row">
            <textarea class="chat-input" id="chatInput" placeholder="向 ${M.state.deviceName || '夏海·新纪元'} 发送消息..."
              rows="1" style="min-height:24px;"></textarea>
            <button class="chat-send-btn" id="btnSend" title="发送">${Icons.iconSend}</button>
            <button class="chat-send-btn hidden" id="btnStop" title="停止" style="background:var(--danger);">${Icons.iconStop}</button>
          </div>
        </div>
      </div>
    `;

    bindChatEvents();
    chatRendered = true;
    scrollToBottom();
    updateSendButton();
  }

  function renderMessages(messages) {
    return messages.map((msg, i) => `
      <div class="message ${msg.role}" id="msg-${i}">
        <div class="message-header">
          <span>${msg.role === 'user' ? '你' : (M.state.deviceName || '夏海·新纪元')}</span>
          ${msg.role === 'assistant' && msg.model ? `<span style="color:var(--text-secondary);font-size:11px;">· ${M.escapeHtml(getModelDisplayName(msg.model))}</span>` : ''}
          ${(msg.reasoning || msg.reasoning_content) ? '<span style="color:var(--success);">· 深度思考</span>' : ''}
        </div>
        ${(msg.reasoning || msg.reasoning_content) ? `
          <div class="reasoning-toggle" data-msg="${i}">
            ${Icons.iconChevronRight} 查看思考过程
          </div>
          <div class="reasoning-content hidden" id="reasoning-${i}">${M.escapeHtml(msg.reasoning || msg.reasoning_content || '')}</div>
        ` : ''}
        <div class="message-bubble">${renderMarkdown(typeof msg.content === 'string' ? msg.content : (msg.text || ''))}</div>
        <div class="message-actions">
          <button class="message-action-btn" data-action="copy" data-msg="${i}">${Icons.iconCopy} 复制</button>
          ${msg.role === 'user' ? `<button class="message-action-btn" data-action="delete" data-msg="${i}">${Icons.iconTrash} 撤回</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    let html = M.escapeHtml(text);
    // 代码块 - 用 base64 存储原始代码避免双重转义
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const langLabel = lang || 'code';
      const rawCode = code.trim();
      const encoded = btoa(unescape(encodeURIComponent(rawCode)));
      return `<div class="code-block-header"><span>${langLabel}</span><button class="code-copy-btn" data-code-b64="${encoded}">${Icons.iconCopy} 复制</button></div><pre><code>${M.escapeHtml(rawCode)}</code></pre>`;
    });
    // 加粗
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 换行
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function bindChatEvents() {
    const input = document.getElementById('chatInput');
    const btnSend = document.getElementById('btnSend');
    const btnStop = document.getElementById('btnStop');

    // 自动高度
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });

    // 发送
    btnSend?.addEventListener('click', () => {
      const text = input.value.trim();
      const attachments = getAttachments();
      if (text || attachments.length > 0) {
        M.sendMessage(text, attachments);
        input.value = '';
        input.style.height = 'auto';
        clearAttachments();
      }
    });

    // Enter 发送，Shift+Enter 换行
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btnSend?.click();
      }
    });

    // 停止生成
    btnStop?.addEventListener('click', () => M.stopGenerating());

    // 权限切换 - 乐观更新
    document.getElementById('permissionSwitch')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.permission-btn');
      if (!btn) return;
      // 立即更新 UI
      document.querySelectorAll('#permissionSwitch .permission-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === btn.dataset.mode);
      });
      M.setPermission(btn.dataset.mode);
    });

    // 模型切换
    document.getElementById('modelSelect')?.addEventListener('change', (e) => {
      M.setModel(e.target.value);
    });

    // 流式开关 - 乐观更新
    document.getElementById('streamToggle')?.addEventListener('click', () => {
      const btn = document.getElementById('streamToggle');
      btn.classList.toggle('active', !M.state.streamEnabled);
      M.setStream(!M.state.streamEnabled);
    });

    // 思考过程展开
    document.getElementById('chatMessages')?.addEventListener('click', (e) => {
      const toggle = e.target.closest('.reasoning-toggle');
      if (toggle) {
        const msgId = toggle.dataset.msg;
        const content = document.getElementById('reasoning-' + msgId);
        if (content) {
          content.classList.toggle('hidden');
          toggle.querySelector('svg').outerHTML = content.classList.contains('hidden') ? Icons.iconChevronRight : Icons.iconChevronDown;
        }
      }
      // 复制代码
      const copyBtn = e.target.closest('.code-copy-btn');
      if (copyBtn) {
        try {
          const decoded = decodeURIComponent(escape(atob(copyBtn.dataset.codeB64)));
          navigator.clipboard.writeText(decoded).then(() => {
            copyBtn.innerHTML = `${Icons.iconCheck} 已复制`;
            setTimeout(() => { copyBtn.innerHTML = `${Icons.iconCopy} 复制`; }, 2000);
          });
        } catch (err) {
          console.error('Code copy failed:', err);
        }
      }
      // 复制/撤回消息
      const actionBtn = e.target.closest('.message-action-btn');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        const idx = parseInt(actionBtn.dataset.msg);
        if (action === 'copy') {
          const msgContent = M.state.messages[idx]?.content || M.state.messages[idx]?.text || '';
          navigator.clipboard.writeText(msgContent).then(() => M.showToast('已复制', 'success'));
        } else if (action === 'delete') {
          if (confirm('确认撤回此消息？')) {
            M.state.messages.splice(idx, 1);
            renderChatPanel();
            // 通知桌面端删除该消息
            M.sendWS({ type: 'request', method: 'chat.delete', payload: { taskId: M.state.currentTaskId, index: idx } });
          }
        }
      }
    });

    // 上传文件
    document.getElementById('btnUploadFile')?.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.addEventListener('change', handleFileSelect);
      fileInput.click();
    });

    // 上传图片
    document.getElementById('btnUploadImage')?.addEventListener('click', () => {
      const imgInput = document.createElement('input');
      imgInput.type = 'file';
      imgInput.accept = 'image/*';
      imgInput.multiple = true;
      imgInput.addEventListener('change', handleFileSelect);
      imgInput.click();
    });
  }

  let pendingAttachments = [];

  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachments.push({
          name: file.name,
          size: file.size,
          mime: file.type,
          data: reader.result.split(',')[1] || reader.result
        });
        renderAttachmentTags();
      };
      reader.readAsDataURL(file);
    });
  }

  function getAttachments() { return pendingAttachments; }
  function clearAttachments() { pendingAttachments = []; renderAttachmentTags(); }

  function renderAttachmentTags() {
    const container = document.getElementById('attachmentTags');
    if (!container) return;
    container.innerHTML = pendingAttachments.map((a, i) => `
      <span class="attachment-tag" data-idx="${i}">
        ${a.mime?.startsWith('image/') ? Icons.iconImage : Icons.iconFile}
        <span class="attachment-tag-name">${M.escapeHtml(a.name)}</span>
        <span class="attachment-tag-size">(${M.formatBytes(a.size)})</span>
        <span class="attachment-tag-remove" data-idx="${i}">&times;</span>
      </span>
    `).join('');
  }

  // 委托：点击删除按钮
  document.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.attachment-tag-remove');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.idx);
      pendingAttachments.splice(idx, 1);
      renderAttachmentTags();
    }
  });

  function updateModelSelect() {
    const sel = document.getElementById('modelSelect');
    if (!sel) return;
    sel.innerHTML = renderModelOptions(M.state.model);
    sel.value = M.state.model;
  }

  function updatePermissionSwitch() {
    document.querySelectorAll('.permission-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === M.state.permissionMode);
    });
  }

  function updateStreamToggle() {
    const btn = document.getElementById('streamToggle');
    if (btn) btn.classList.toggle('active', M.state.streamEnabled);
  }

  function updateSendButton() {
    const btnSend = document.getElementById('btnSend');
    const btnStop = document.getElementById('btnStop');
    if (M.state.isGenerating) {
      btnSend?.classList.add('hidden');
      btnStop?.classList.remove('hidden');
    } else {
      btnSend?.classList.remove('hidden');
      btnStop?.classList.add('hidden');
    }
  }

  // 流式消息
  function addStreamingMessage() {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.chat-empty');
    if (empty) empty.remove();
    const msgEl = document.createElement('div');
    msgEl.className = 'message assistant';
    msgEl.id = streamingMessageId;
    msgEl.innerHTML = `
      <div class="message-header"><span>${M.state.deviceName || '夏海·新纪元'}</span></div>
      <div class="message-bubble"><span class="streaming-cursor"></span></div>
    `;
    container.appendChild(msgEl);
    scrollToBottom();
  }

  function updateStreamingMessage() {
    const el = document.getElementById(streamingMessageId);
    if (!el) return;
    const bubble = el.querySelector('.message-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(streamingContent) + '<span class="streaming-cursor"></span>';
    }
    scrollToBottom();
  }

  function finalizeStreamingMessage(payload) {
    const el = document.getElementById(streamingMessageId);
    if (!el) return;
    const bubble = el.querySelector('.message-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(streamingContent);
      el.querySelector('.streaming-cursor')?.remove();
    }
    // 优先使用 payload 中的 reasoning（如果 chunk 没累积完），否则用累积的 streamingReasoning
    const finalReasoning = (payload && payload.reasoning) || streamingReasoning;
    if (finalReasoning) {
      const header = el.querySelector('.message-header');
      if (header) {
        header.innerHTML += '<span style="color:var(--success);">· 深度思考</span>';
        const toggle = document.createElement('div');
        toggle.className = 'reasoning-toggle';
        toggle.innerHTML = `${Icons.iconChevronRight} 查看思考过程`;
        const content = document.createElement('div');
        content.className = 'reasoning-content hidden';
        content.textContent = finalReasoning;
        toggle.addEventListener('click', () => {
          content.classList.toggle('hidden');
          toggle.querySelector('svg').outerHTML = content.classList.contains('hidden') ? Icons.iconChevronRight : Icons.iconChevronDown;
        });
        el.insertBefore(toggle, bubble);
        el.insertBefore(content, bubble);
      }
    }
    updateSendButton();
  }

  function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  // 监听 isGenerating 变化
  const origSend = M.sendMessage.bind(M);
  M.sendMessage = function(text, attachments) {
    origSend(text, attachments);
    setTimeout(() => updateSendButton(), 100);
  };
  const origStop = M.stopGenerating.bind(M);
  M.stopGenerating = function() {
    origStop();
    setTimeout(() => updateSendButton(), 100);
  };
})();