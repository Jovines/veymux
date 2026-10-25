import { randomBytes, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { loadOnboardingTheme } from './utils/onboardingTheme.js';

export function onboardingFingerprint(caCertPath?: string): string | null {
  try { return caCertPath ? new X509Certificate(fs.readFileSync(caCertPath)).fingerprint256 : null; }
  catch { return null; }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const instructions: Record<string, { label: string; steps: string[] }> = {
  ios: { label: 'iPhone / iPad', steps: ['请用 Safari 下载。打开「设置 → 已下载描述文件」，按提示安装。', '打开「设置 → 通用 → 关于本机 → 证书信任设置」，为此根证书开启完全信任。', '回到此页面，点下方「继续访问」。'] },
  mac: { label: 'Mac', steps: ['下载后打开证书，按提示导入「钥匙串访问」。', '在钥匙串中找到刚导入的证书，双击打开「信任」，将安全套接字层（SSL）设为「始终信任」，按系统提示确认。', '回到此页面，点下方「继续访问」。'] },
  windows: { label: 'Windows', steps: ['下载后打开证书，选择「安装证书 → 当前用户」。', '选择「将所有的证书都放入下列存储」，浏览并选择「受信任的根证书颁发机构」，核对来源后确认。', '回到此页面，点下方「继续访问」。'] },
  android: { label: 'Android', steps: ['下载证书后，打开系统设置中的「安全」或「安全与隐私」。', '找到「更多安全设置 → 加密与凭据 → 安装证书 → CA 证书」，选择下载的文件并确认。不同品牌的菜单名称可能不同。', '回到浏览器点「继续访问」。如果浏览器仍不信任，请让分享者提供受信任的 HTTPS 域名链接。'] },
  other: { label: 'Linux / 其他设备', steps: ['下载证书，在浏览器的「设置 → 隐私与安全 → 证书」中找到证书管理。', '将证书导入受信任的证书颁发机构，核对来源后允许验证网站。浏览器使用系统证书库时，请在系统证书管理中导入。', '回到此页面，点下方「继续访问」。'] },
};

/** Public installation guidance only. No business API, identity or session is loaded over HTTP. */
export function sendOnboardingPage(req: Request, res: Response, options: { httpsPort: number; caCertPath?: string }): void {
  const fingerprint = onboardingFingerprint(options.caCertPath);
  if (!fingerprint) { res.status(503).type('text').send('证书暂不可用，请联系分享者重新生成链接。'); return; }
  let target: URL;
  try {
    target = new URL(`http://${req.headers.host}`);
    if (target.username || target.password || target.pathname !== '/') throw new Error('Invalid host');
    target.protocol = 'https:'; target.port = String(options.httpsPort); target.pathname = '/';
  } catch { res.status(400).type('text').send('连接地址无效，请向分享者索取新链接。'); return; }
  const nonce = randomBytes(18).toString('base64');
  const ua = req.headers['user-agent'] || '';
  const device = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'ios' : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'windows' : /Macintosh/.test(ua) ? 'mac' : 'other';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>安全连接 · Termdock</title><style nonce="${nonce}">
${loadOnboardingTheme()}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:15px/1.6 system-ui,-apple-system,sans-serif}main{width:min(100%,580px);margin:0 auto;padding:28px 20px max(24px,env(safe-area-inset-bottom))}header p{margin:0;color:var(--muted-foreground);font-size:13px;letter-spacing:.04em}h1{font-size:26px;line-height:1.3;margin:10px 0}p{margin:8px 0}.intro{color:var(--muted-foreground)}.host{overflow-wrap:anywhere;color:var(--foreground)}.notice{border-left:3px solid var(--warning);padding:2px 12px;margin:18px 0;font-size:13px}.notice p{margin:4px 0}section{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin:14px 0}h2{font-size:17px;margin:0 0 8px}.row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}select{max-width:100%;border:1px solid var(--border);background:var(--surface-2);color:var(--foreground);border-radius:8px;padding:8px;font:inherit;font-size:14px;min-height:44px}ol{padding-left:22px;font-size:14px;margin:12px 0}li{padding-left:3px;margin:7px 0}a.action{display:flex;align-items:center;justify-content:center;min-height:46px;padding:10px 14px;border-radius:9px;text-decoration:none;font-weight:600;border:1px solid var(--border);color:var(--foreground)}a.primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}a:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}small,.muted{color:var(--muted-foreground);font-size:13px}details{font-size:13px;margin:16px 0}summary{cursor:pointer;min-height:36px;display:list-item}code{display:block;word-break:break-all;background:var(--surface);border-radius:8px;padding:10px;user-select:all;font-size:12px}#download-status:empty{display:none}[hidden]{display:none!important}footer{color:var(--muted-foreground);font-size:12px}@media(max-width:420px){main{padding:20px 16px max(20px,env(safe-area-inset-bottom))}h1{font-size:24px}section{padding:14px}}
</style></head><body><main><header><p>TERMDOCK · 首次连接</p><h1>先建立安全连接</h1><p class="intro">这台设备使用自己的安全证书。安装并信任后，浏览器才能正常验证它，分享内容将通过 HTTPS 打开。通常只需设置一次。</p></header>
<div class="notice"><p><strong>仅为你信任的分享者安装。</strong>根证书的信任范围不限于本次分享，也会影响其他网站的证书验证。不确定来源时，请先停止并联系分享者。</p></div>
<section><div class="row"><h2>1. 下载并安装证书</h2><label><span class="muted">你的设备 </span><select id="device" aria-label="你的设备">${Object.entries(instructions).map(([key, value]) => `<option value="${key}"${key === device ? ' selected' : ''}>${value.label}</option>`).join('')}</select></label></div>
${Object.entries(instructions).map(([key, value]) => `<ol data-device="${key}"${key === device ? '' : ' hidden'}>${value.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`).join('')}
<a id="download" class="action primary" href="/onboarding/ca.crt" download="termdock-ca.crt">下载证书</a><p id="download-status" class="muted" role="status"></p></section>
<section><h2>2. 返回这里，继续访问</h2><p class="muted">已在系统中完成信任，或以前安装过此证书？可以直接继续。</p><a id="continue" class="action" href="${escapeHtml(target.href)}">继续访问</a><p class="muted">若仍出现证书错误，请返回检查是否已开启信任，不必跳过浏览器警告。</p></section>
<details><summary>核对证书与安全说明</summary><p>此引导页通过 HTTP 提供，无法单凭这个页面确认设备身份。请通过你已信任的对话渠道，与分享者核对以下 SHA-256 指纹后再安装。</p><code>${escapeHtml(fingerprint)}</code><p>目标地址：<span class="host">${escapeHtml(target.origin)}</span></p><p>下载证书不会自动获得系统信任，也不会自动接受分享邀请。进入 HTTPS 页面后，仍按原分享权限验证。</p><p>不再需要时，可在系统或浏览器的证书管理中移除此根证书；iPhone / iPad 可删除对应的描述文件。</p></details><footer>HTTP 仅用于安装引导。此页不加载终端、聊天或文件内容。</footer></main>
<script nonce="${nonce}">
const device=document.getElementById('device');device.addEventListener('change',()=>{document.querySelectorAll('[data-device]').forEach(list=>{list.hidden=list.dataset.device!==device.value;});});
const next=document.getElementById('continue');const destination=new URL(next.href);if(location.hash.startsWith('#termdock-invite=')&&location.hash.length<=8250)destination.hash=location.hash;next.href=destination.href;
next.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();history.replaceState(null,'',location.pathname);location.replace(destination.href);});
document.getElementById('download').addEventListener('click',()=>{document.getElementById('download-status').textContent='下载已发起。请完成上面的系统安装与信任步骤，再继续访问。';document.getElementById('download').classList.remove('primary');next.classList.add('primary');});
</script></body></html>`);
}
