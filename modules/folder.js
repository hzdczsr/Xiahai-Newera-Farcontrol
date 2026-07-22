// folder.js - 文件夹/文件浏览模块
// 目录树、文件查看器

(function() {
  const M = window.App;
  if (!M) { console.error('App not initialized'); return; }

  let treeData = null;
  let selectedPath = null;
  let fileContent = null;

  M.on('tab:folder', () => {
    renderFolderPanel();
    if (M.state.workDir) M.requestFileTree(M.state.workDir);
  });

  M.on('folder:changed', (path) => {
    if (M.state.activeTab === 'folder') {
      renderFolderPanel();
      if (path) M.requestFileTree(path);
    }
  });

  M.on('snapshot:applied', () => {
    if (M.state.activeTab === 'folder' && M.state.workDir) {
      M.requestFileTree(M.state.workDir);
    }
  });

  function renderFolderPanel() {
    const container = document.getElementById('fileLayout');
    if (!container) return;

    container.innerHTML = `
      <div class="file-tree" id="fileTree">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-muted);">${M.escapeHtml(M.state.workDir || '工作目录')}</span>
          <button class="btn-icon" id="btnOpenFolder" title="切换目录" style="width:24px;height:24px;">${Icons.iconFolderOpen}</button>
        </div>
        <div class="loading-dots" id="treeLoading" style="justify-content:center;padding:12px;">
          <span></span><span></span><span></span>
        </div>
        <div id="treeContent"></div>
      </div>
      <div class="file-viewer">
        <div class="file-viewer-toolbar">
          <span class="file-viewer-path" id="fileViewerPath">选择文件查看</span>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" id="btnRefreshFile" title="刷新" style="width:28px;height:28px;">${Icons.iconRefresh}</button>
            <button class="btn-icon" id="btnDownloadFile" title="下载" style="width:28px;height:28px;">${Icons.iconDownload}</button>
          </div>
        </div>
        <div class="file-viewer-content" id="fileViewerContent">
          <div class="file-binary" id="filePlaceholder">选择一个文件以查看内容</div>
        </div>
      </div>
    `;

    bindFolderEvents();
  }

  function bindFolderEvents() {
    document.getElementById('btnOpenFolder')?.addEventListener('click', () => {
      M.openFolderDialog();
    });

    document.getElementById('btnRefreshFile')?.addEventListener('click', () => {
      if (selectedPath) {
        M.readFile(selectedPath);
      } else if (M.state.workDir) {
        M.requestFileTree(M.state.workDir);
      }
    });
  }

  // 响应文件树数据
  M.on('file:changed', () => {
    if (M.state.activeTab === 'folder' && M.state.workDir) {
      M.requestFileTree(M.state.workDir);
    }
  });

  // 渲染目录树
  function renderTree(node, depth = 0) {
    if (!node) return '';
    const isDir = node.isDirectory || node.children;
    const children = node.children || node.items || [];
    const indent = depth > 0 ? `<span class="tree-indent" style="width:${depth * 14}px;"></span>` : '';

    return `
      <div class="tree-item ${node.path === selectedPath ? 'selected' : ''}" data-path="${node.path || ''}" data-is-dir="${isDir}">
        ${indent}
        ${isDir ? Icons.iconFolder : Icons.iconFile}
        <span class="tree-item-name">${M.escapeHtml(node.name)}</span>
        ${node.size ? `<span class="tree-item-size">${M.formatBytes(node.size)}</span>` : ''}
      </div>
      ${isDir && children.length > 0 ? `<div class="tree-children">${children.map(c => renderTree(c, depth + 1)).join('')}</div>` : ''}
    `;
  }

  // 注册文件树响应
  const origHandleWS = M.handleWSMessage.bind(M);
  M.handleWSMessage = function(msg) {
    origHandleWS(msg);
    const data = msg.payload && msg.payload.data;
    if (msg.type === 'response' && data && data.tree) {
      treeData = data.tree;
      applyTreeData();
    }
    if (msg.type === 'response' && data && Array.isArray(data.children)) {
      // 动态展开子目录：找到对应节点并填充 children
      appendChildrenToNode(selectedPath, data.children);
    }
    if (msg.type === 'response' && data && data.content !== undefined) {
      fileContent = data.content;
      applyFileContent();
    }
  };

  function appendChildrenToNode(parentPath, children) {
    if (!treeData || !parentPath) return;
    const container = document.getElementById('treeContent');
    if (!container) return;
    const item = container.querySelector(`.tree-item[data-path="${CSS.escape(parentPath)}"]`);
    if (!item) return;
    // 移除已有的子节点容器，避免重复
    let childContainer = item.nextElementSibling;
    if (childContainer && childContainer.classList.contains('tree-children')) {
      childContainer.remove();
    }
    const rootNode = {
      name: parentPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '目录',
      path: parentPath,
      isDirectory: true,
      children: children
    };
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-children';
    wrapper.innerHTML = renderTree(rootNode, 0);
    // 移除根节点自身，只保留子节点
    const ownItem = wrapper.querySelector('.tree-item');
    if (ownItem) ownItem.remove();
    item.after(wrapper);
    bindTreeItemEvents(wrapper);
  }

  function bindTreeItemEvents(container) {
    container.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const path = item.dataset.path;
        const isDir = item.dataset.isDir === 'true';
        selectedPath = path;
        if (isDir) {
          M.requestFileChildren(path);
        } else {
          M.readFile(path);
          const viewer = document.getElementById('fileViewerPath');
          if (viewer) viewer.textContent = path;
        }
        document.querySelectorAll('#treeContent .tree-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  function applyTreeData() {
    const container = document.getElementById('treeContent');
    const loading = document.getElementById('treeLoading');
    if (!container) return;
    if (loading) loading.style.display = 'none';

    if (!treeData || !Array.isArray(treeData) || treeData.length === 0) {
      container.innerHTML = '<div style="color:var(--text-faint);padding:12px;font-size:12px;">目录为空或未设置工作目录</div>';
      return;
    }
    // 服务端返回 tree 数组，包装成虚拟根节点以便统一渲染
    const workDir = M.state.workDir || '';
    const rootName = workDir ? workDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() : '工作目录';
    const rootNode = {
      name: rootName,
      path: workDir,
      isDirectory: true,
      children: treeData
    };
    container.innerHTML = renderTree(rootNode);
    bindTreeItemEvents(container);
  }

  function applyFileContent() {
    const viewer = document.getElementById('fileViewerContent');
    const placeholder = document.getElementById('filePlaceholder');
    if (!viewer) return;
    if (placeholder) placeholder.style.display = 'none';

    if (typeof fileContent === 'string') {
      const lines = fileContent.split('\n');
      viewer.innerHTML = `<div class="file-content">${lines.map((line, i) => `
        <div class="file-content-line">
          <span class="file-line-number">${i + 1}</span>
          <span class="file-line-text">${M.escapeHtml(line)}</span>
        </div>
      `).join('')}</div>`;
    } else {
      viewer.innerHTML = '<div class="file-binary">二进制文件，无法预览</div>';
    }
  }
})();