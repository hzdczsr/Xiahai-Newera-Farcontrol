// connection.js - 连接状态管理模块
// 负责连接状态 UI 更新、重连提示、断开处理

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  // 连接状态变化
  M.on('connection:lost', () => {
    M.showToast('与桌面端断开连接，正在尝试重连...', 'warning');
    M.updateConnectionUI();
  });

  M.on('latency:update', () => {
    M.updateConnectionUI();
  });

  M.on('client.connected', (payload) => {
    M.showToast(`客户端已连接: ${payload.name || payload.id}`, 'info');
  });

  M.on('client.disconnected', (payload) => {
    M.showToast(`客户端已断开: ${payload.name || payload.id}`, 'info');
  });

  // 配对页 Enter 键重连
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && M.state.phase === 'disconnected') {
      // 回到配对页后按 Enter 快速连接
      const ipInput = document.getElementById('pairingIp');
      if (ipInput && document.activeElement !== ipInput) {
        M.doConnect();
      }
    }
  });
})();