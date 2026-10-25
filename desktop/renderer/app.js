const api = window.termdockDesktop;

const elements = {
  notice: document.querySelector('#notice'),
  refresh: document.querySelector('#refresh'),
  localState: document.querySelector('#local-state'),
  localDetail: document.querySelector('#local-detail'),
  localAddress: document.querySelector('#local-address'),
  visualStatus: document.querySelector('#visual-status'),
  navLocalDot: document.querySelector('#nav-local-dot'),
  connectLocal: document.querySelector('#connect-local'),
  prepareLocal: document.querySelector('#prepare-local'),
  localInstallHint: document.querySelector('#local-install-hint'),
  localDiagnostics: document.querySelector('#local-diagnostics'),
  localDiagnosticsContent: document.querySelector('#local-diagnostics-content'),
  menuBarStatusEnabled: document.querySelector('#menu-bar-status-enabled'),
  floatingWidgetEnabled: document.querySelector('#floating-widget-enabled'),
  desktopStatusPreview: document.querySelector('#desktop-status-preview'),
  connectionCount: document.querySelector('#connection-count'),
  version: document.querySelector('#version'),
  startupProgress: document.querySelector('#startup-progress'),
  startupProgressMessage: document.querySelector('#startup-progress-message'),
  pageTitle: document.querySelector('#page-title'),
  pageDescription: document.querySelector('#page-description'),
  workspace: document.querySelector('#workspace'),
  guideNext: document.querySelector('#guide-next'),
};

let currentSnapshot = null;
let localActionPending = false;
let refreshPending = null;
let setupRevision = 0;
let nodeDownloadPending = false;
let nodeDownloadOpened = false;
let connectPending = false;

const pages = {
  local: ['从这台 Mac 开始', '打开终端，或与已配置的 AI 助手一起工作。'],
  remote: ['连接其他电脑', '粘贴服务地址或邀请链接，继续那台电脑上的工作。'],
  'desktop-status': ['让桌面更顺手', '选择适合自己的状态显示方式。'],
  guide: ['第一次使用，从这里开始', '选一件想做的事，跟着三步开始。'],
};

function navigatePanel(focus = false) {
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(pages, requested) ? requested : 'local';
  for (const panel of document.querySelectorAll('.center-panel')) panel.hidden = panel.id !== page;
  for (const link of document.querySelectorAll('.rail-nav a')) {
    const selected = link.getAttribute('href') === `#${page}`;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  [elements.pageTitle.textContent, elements.pageDescription.textContent] = pages[page];
  elements.refresh.hidden = page !== 'local';
  elements.workspace.scrollTop = 0;
  if (focus) elements.pageTitle.focus({ preventScroll: true });
}

window.addEventListener('hashchange', () => navigatePanel(true));
navigatePanel();

for (const button of document.querySelectorAll('[data-guide]')) {
  button.addEventListener('click', () => {
    const selected = button.dataset.guide;
    for (const choice of document.querySelectorAll('[data-guide]')) {
      choice.setAttribute('aria-pressed', String(choice === button));
    }
    for (const content of document.querySelectorAll('[data-guide-content]')) {
      content.hidden = content.dataset.guideContent !== selected;
    }
    elements.guideNext.href = selected === 'remote' ? '#remote' : '#local';
    elements.guideNext.textContent = selected === 'remote' ? '去连接其他电脑 →' : '回到这台 Mac →';
  });
}


api.onStartupProgress?.((message) => {
  elements.startupProgress.hidden = !message;
  if (message) elements.startupProgressMessage.textContent = message;
});

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('error', error);
  elements.notice.hidden = false;
}

function clearNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = '';
}

function render(snapshot) {
  currentSnapshot = snapshot;
  elements.version.textContent = `Termdock Desktop ${snapshot.appVersion}`;
  elements.connectionCount.textContent = String(snapshot.connections.length);
  elements.connectionCount.hidden = snapshot.connections.length === 0;

  const local = snapshot.localService;
  const setup = local.setup || { phase: 'checking', message: '正在检测本机服务和运行环境…' };
  const labels = {
    checking: '检测中', starting: '启动中', installing: '安装中',
    'needs-node': '需要运行环境', 'needs-install': '尚未安装', error: '需要处理', ready: '服务已停止',
  };
  const pending = localActionPending || nodeDownloadPending || ['checking', 'starting', 'installing'].includes(setup.phase);
  elements.localState.querySelector('span').textContent = local.running ? '已就绪' : labels[setup.phase] || '等待准备';
  elements.localState.classList.toggle('ok', local.running);
  elements.localState.classList.toggle('pending', !local.running && pending);
  elements.localState.classList.toggle('error', !local.running && setup.phase === 'error');
  elements.navLocalDot.classList.toggle('ok', local.running);
  const descriptions = {
    checking: ['正在检查这台 Mac…', '找到运行环境后，就能准备工作空间。'],
    'needs-node': [nodeDownloadOpened ? '安装完成后，回到这里' : '先安装运行环境', '本机终端需要 Node.js 22 或更新版本。'],
    'needs-install': ['为你的工作准备一个空间', '安装本机服务，用来运行和保留终端会话。'],
    installing: ['正在准备工作空间…', '正在下载并安装本机服务，首次可能需要几分钟。'],
    starting: ['正在启动工作空间…', '已有会话会保留，马上就好。'],
    ready: ['继续这台 Mac 上的工作', '启动本机服务后，就可以打开工作空间。'],
    error: ['准备遇到了问题', setup.message || '请重试，或展开下方详情查看原因。'],
  };
  const description = local.running
    ? ['一切就绪，可以开始了', '打开后，在左下角新建终端或启动已配置的 AI 助手。']
    : descriptions[setup.phase] || ['暂时无法确认环境', '点击重新检测，或展开下方详情查看原因。'];
  [elements.visualStatus.textContent, elements.localDetail.textContent] = description;
  const environmentReady = ['needs-install', 'installing', 'starting', 'ready'].includes(setup.phase)
    || (setup.phase === 'error' && (setup.nodeVersion || setup.cliPath));
  const step = local.running ? 2 : environmentReady ? 1 : 0;
  for (const item of document.querySelectorAll('[data-setup-step]')) {
    const index = Number(item.dataset.setupStep);
    item.classList.toggle('complete', index < step);
    item.classList.toggle('current', index === step);
    item.querySelector('.step-marker').textContent = index < step ? '✓' : String(index + 1);
    if (index === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  document.querySelector('.setup-body').classList.toggle('setup-error', !local.running && setup.phase === 'error');
  elements.connectLocal.hidden = !local.running;
  elements.connectLocal.disabled = connectPending;
  elements.connectLocal.setAttribute('aria-busy', String(connectPending));
  elements.connectLocal.querySelector('span').textContent = connectPending ? '正在打开…' : '打开工作空间';
  elements.prepareLocal.hidden = local.running;
  elements.prepareLocal.disabled = pending;
  elements.refresh.disabled = pending;
  const actionLabels = {
    checking: '正在检测…', starting: '正在启动…', installing: '正在安装…',
    'needs-node': nodeDownloadOpened ? '再次打开下载页 ↗' : '下载 Node.js ↗', 'needs-install': '安装并启动', error: '重试准备', ready: '启动工作空间',
  };
  elements.prepareLocal.textContent = nodeDownloadPending ? '正在打开下载页…' : actionLabels[setup.phase] || '重新检测';
  elements.prepareLocal.setAttribute('aria-busy', String(pending));
  elements.localInstallHint.hidden = local.running || !['needs-node', 'needs-install', 'installing'].includes(setup.phase);
  elements.localInstallHint.textContent = setup.phase === 'needs-node'
    ? '前往官网安装，完成后回到这里，会自动继续检查。'
    : setup.phase === 'installing' ? '完成后会自动启动。你可以先看看使用指南。'
      : '从 npm 下载到当前用户目录，无需 sudo；首次安装可能需要系统依赖。';
  const diagnostics = [
    setup.nodeVersion && `Node.js ${setup.nodeVersion}`,
    setup.cliPath && `Termdock CLI: ${setup.cliPath}`,
    local.state && `服务 PID: ${local.state.pid}`,
    setup.details,
  ].filter(Boolean).join('\n');
  elements.localDiagnosticsContent.hidden = !diagnostics;
  elements.localDiagnosticsContent.textContent = diagnostics;
  elements.localDiagnostics.querySelector('summary').textContent = !local.running && setup.phase === 'error'
    ? '查看问题与环境详情' : '连接与环境详情';
  if (local.running) {
    const serviceUrl = local.probe?.url || local.state?.localUrl;
    elements.localAddress.textContent = serviceUrl || 'localhost';
  } else {
    elements.localAddress.textContent = local.state?.localUrl || `localhost:${local.state?.port || 9834}`;
  }

  elements.menuBarStatusEnabled.checked = snapshot.desktopPreferences.menuBarStatusEnabled;
  elements.floatingWidgetEnabled.checked = snapshot.desktopPreferences.floatingWidgetEnabled;


}

async function saveDesktopPreference(input, key) {
  const previous = !input.checked;
  input.disabled = true;
  clearNotice();
  try {
    currentSnapshot = await api.updateDesktopPreferences({ [key]: input.checked });
    render(currentSnapshot);
  } catch (error) {
    input.checked = previous;
    showNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    input.disabled = false;
  }
}

async function refresh() {
  if (refreshPending) return refreshPending;
  const revision = setupRevision;
  refreshPending = api.snapshot().then(snapshot => {
    if (revision !== setupRevision && currentSnapshot?.localService.setup) {
      snapshot.localService.setup = currentSnapshot.localService.setup;
    }
    render(snapshot);
  }).finally(() => { refreshPending = null; });
  return refreshPending;
}

async function prepareLocal(install = false) {
  if (localActionPending) return;
  localActionPending = true;
  clearNotice();
  if (currentSnapshot) render(currentSnapshot);
  try {
    render(await api.prepareLocalService(install));
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    localActionPending = false;
    if (currentSnapshot) render(currentSnapshot);
  }
}

elements.refresh.addEventListener('click', () => { void prepareLocal(); });

elements.prepareLocal.addEventListener('click', () => {
  if (currentSnapshot?.localService.setup?.phase === 'needs-node') {
    void downloadNode();
    return;
  }
  // An explicit retry also resumes a failed or interrupted CLI installation.
  void prepareLocal(true);
});

async function downloadNode() {
  if (nodeDownloadPending) return;
  nodeDownloadPending = true;
  clearNotice();
  render(currentSnapshot);
  try {
    await api.downloadNode();
    nodeDownloadOpened = true;
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    nodeDownloadPending = false;
    render(currentSnapshot);
  }
}

api.onLocalServiceSetup((setup) => {
  setupRevision += 1;
  if (currentSnapshot) {
    currentSnapshot.localService.setup = setup;
    render(currentSnapshot);
  }
  if (setup.phase === 'ready') void refresh().catch(() => {});
});

async function checkEnvironment() {
  if (document.hidden || localActionPending) return;
  try {
    if (currentSnapshot?.localService.setup?.phase === 'needs-node') await prepareLocal();
    else await refresh();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  }
}

window.addEventListener('focus', () => { void checkEnvironment(); });
setInterval(() => { void checkEnvironment(); }, 10_000);

elements.connectLocal.addEventListener('click', () => {
  if (connectPending) return;
  connectPending = true;
  clearNotice();
  render(currentSnapshot);
  void (async () => {
    try {
      const url = currentSnapshot?.localService?.probe?.url;
      if (!url) throw new Error('本机服务地址不可用');
      const result = await api.connect(url);
      if (!result.ok) showNotice(result.error || '连接失败', true);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      connectPending = false;
      render(currentSnapshot);
    }
  })();
});

elements.menuBarStatusEnabled.addEventListener('change', () => {
  void saveDesktopPreference(elements.menuBarStatusEnabled, 'menuBarStatusEnabled');
});

elements.floatingWidgetEnabled.addEventListener('change', () => {
  void saveDesktopPreference(elements.floatingWidgetEnabled, 'floatingWidgetEnabled');
});

void refresh().catch((error) => {
  showNotice(error instanceof Error ? error.message : String(error), true);
});

api.onDesktopStatus((status) => {
  elements.desktopStatusPreview.textContent = status.text;
  elements.desktopStatusPreview.title = status.tooltip;
});
void api.desktopStatus().then((status) => {
  elements.desktopStatusPreview.textContent = status.text;
  elements.desktopStatusPreview.title = status.tooltip;
});
