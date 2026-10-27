// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FederationAccess } from './FederationAccess';
import { createInviteLink, createOnboardingInviteLink, parseInviteLink } from '../lib/federation/inviteLink';
vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') }));
const serviceId = '12D3KooW' + '1'.repeat(44);
const code = 'secret-invite-code'.repeat(3);
const inviteUrl = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://c.example', name: '工作电脑' });
function more() { const button = screen.getByRole('button', { name: /更多选项/ }); if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button); }
function allWhenEmpty() { if (screen.queryByRole('button', { name: /已选 [1-9]/ })) return; fireEvent.click(screen.getByRole('radio', { name: '全部终端' })); }
afterEach(() => { cleanup(); localStorage.clear(); Reflect.deleteProperty(navigator, 'clipboard'); document.documentElement.style.removeProperty('--background'); document.documentElement.style.removeProperty('--foreground'); });
describe('FederationAccess invitation flow', () => {
  it('offers original HTTPS without installing a CA or redeeming the HTTP invitation', () => {
    const original = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://192.168.1.20:9834', viewMode: 'chat', viewLayout: 'split' });
    const invitation = parseInviteLink(createOnboardingInviteLink(original, 'http://192.168.1.20:21000/connect'), { httpTransport: true });
    const onConnect = vi.fn();
    render(<FederationAccess initialInvite={invitation} onConnect={onConnect} onClose={() => {}} />);
    const https = screen.getByRole('link', { name: /HTTPS 打开/ });
    expect(parseInviteLink(https.getAttribute('href')!)).toMatchObject({ url: 'https://192.168.1.20:9834', targetPeerId: serviceId, pairingCode: code, viewMode: 'chat', viewLayout: 'split' });
    https.addEventListener('click', event => event.preventDefault()); fireEvent.click(https);
    expect(onConnect).not.toHaveBeenCalled();
    expect(parseInviteLink(https.getAttribute('href')!).showAccessGuide).toBe(false);
    expect(screen.getByText('若提示不安全，选择继续访问即可。')).toBeTruthy();
    expect(screen.getByText('直接访问，部分功能缺失')).toBeTruthy();
    expect(screen.getByRole('button', { name: /HTTP 打开/ })).toBeTruthy();
    fireEvent.click(screen.getByText('不想看到证书提示？'));
    expect(screen.getByRole('link', { name: '安装本地 CA 证书' })).toBeTruthy();
  });
  it('adds reusable unlimited chat sharing with a separate clear-display permission', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: null });
    render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '构建任务' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    fireEvent.click(screen.getByRole('radio', { name: /仅对话/ }));
    expect((screen.getByRole('button', { name: '终端' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '链接使用' }), { target: { value: 'multiple' } });
    fireEvent.change(screen.getByRole('combobox', { name: '链接有效期' }), { target: { value: 'never' } });
    more(); fireEvent.click(screen.getByRole('checkbox', { name: '允许接收者清空自己的聊天显示' }));
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ scope: { kind: 'sessions', sessionIds: ['one'] }, actions: ['session.chat-view', 'session.chat-send', 'session.chat-clear'], reusable: true, linkExpiresAt: null, viewMode: 'chat' }));
    expect(await screen.findByText('可重复使用 · 直到撤销有效')).toBeTruthy();
    expect(screen.queryByText('邀请链接已过期')).toBeNull();
  });
  it('configures chat read-only and a terminal preview independently from terminal control', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '构建任务' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    fireEvent.click(screen.getByRole('button', { name: '按功能自定义权限' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '发送对话消息' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '查看终端预览（未授权控制时只读）' }));
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ actions: ['session.chat-view', 'session.terminal-view'] })));
  });
  it('keeps the selected stable session and its appearance through backend replacement and an empty reconnect snapshot', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    const props = { paired: true, initialShareSessionId: 'stable', onConnect: () => {}, onClose: () => {}, onCreateInvite };
    const view = render(<FederationAccess {...props} sessions={[{ sessionId: 'old-backend', sourceSessionId: 'stable', name: '构建任务' }]} />);
    more();
    fireEvent.change(screen.getByRole('textbox', { name: '分享显示名称' }), { target: { value: '更新后继续分享' } });
    view.rerender(<FederationAccess {...props} sessions={[]} />);
    view.rerender(<FederationAccess {...props} sessions={[{ sessionId: 'new-backend', sourceSessionId: 'stable', name: '构建任务' }]} />);
    expect((screen.getByRole('textbox', { name: '分享显示名称' }) as HTMLInputElement).value).toBe('更新后继续分享');
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'sessions', sessionIds: ['stable'] }, sessionAppearance: { stable: { name: '更新后继续分享' } },
    })));
  });
  it('shares all terminals directly from the first level without changing access permissions or opening more options', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '构建任务' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    expect(screen.getByRole('group', { name: '分享范围' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: '指定会话' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '全部终端' }));
    expect(screen.getByText('包含以后新建的终端')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /已选|选择终端/ })).toBeNull();
    expect(screen.getByRole('button', { name: /更多选项/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledExactlyOnceWith({ viewMode: 'chat', scope: { kind: 'service' }, actions: ['session.view'] }));
  });
  it('retains a specific-session selection when switching back from all terminals', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired initialShareSessionId="stable" sessions={[{ sessionId: 'backend', sourceSessionId: 'stable', name: '构建任务' }, { sessionId: 'other', name: '接口排障' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    fireEvent.click(screen.getByRole('radio', { name: '全部终端' }));
    fireEvent.click(screen.getByRole('radio', { name: '指定会话' }));
    expect(screen.getByText('构建任务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '已选 1 个' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /可操作/ }));
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'sessions', sessionIds: ['stable'] }, actions: ['session.view', 'session.input', 'session.resize'] })));
  });
  it('shows the forced all-terminal scope for explicit full access and restores the previous scope when it is disabled', () => {
    render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '构建任务' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={async () => ({ url: inviteUrl, expiresAt: Date.now() + 600000 })} />);
    more(); fireEvent.click(screen.getByRole('checkbox', { name: '授予完整服务权限' }));
    expect((screen.getByRole('radio', { name: '全部终端' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: '全部终端' }).closest('fieldset')?.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '已选 1 个' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '授予完整服务权限' }));
    expect((screen.getByRole('radio', { name: '指定会话' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: '已选 1 个' })).toBeTruthy();
  });
  it('previews custom sharing appearance, retains it when editing and resets to the Session defaults', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired initialShareSessionId="stable" sessions={[{ sessionId: 'backend', sourceSessionId: 'stable', name: '原会话' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    more();
    fireEvent.change(screen.getByRole('textbox', { name: '分享显示名称' }), { target: { value: '研究工作台' } });
    fireEvent.click(screen.getByRole('button', { name: '更改原会话的分享图标' }));
    fireEvent.change(screen.getByRole('textbox', { name: '原会话的自定义Emoji' }), { target: { value: '🎙️' } });
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ sessionAppearance: { stable: { name: '研究工作台', icon: '🎙️' } } })));
    expect(await screen.findByText('研究工作台')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '调整分享内容 / 重新生成' }));
    expect((screen.getByRole('textbox', { name: '分享显示名称' }) as HTMLInputElement).value).toBe('研究工作台');
    fireEvent.click(screen.getByRole('button', { name: '重置原会话的分享外观' }));
    fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledTimes(2));
    expect(onCreateInvite.mock.calls[1][0].sessionAppearance).toBeUndefined();
  });
  it('confirms revoking the generated invitation and removes its QR and link only on success', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ id: 'pending-one', url: inviteUrl, expiresAt: Date.now() + 600000 });
    const onRevokeInvitation = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} onRevokeInvitation={onRevokeInvitation} />);
    fireEvent.click(screen.getByText('邀请设备')); allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    fireEvent.click(await screen.findByRole('button', { name: '撤销邀请' }));
    expect(onRevokeInvitation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText('复制邀请链接')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销邀请' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤销邀请' }));
    await screen.findByRole('alert');
    expect(screen.getByText('复制邀请链接')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销邀请' }));
    await screen.findByText('邀请已撤销，原链接和二维码已失效。');
    expect(onRevokeInvitation).toHaveBeenLastCalledWith('pending-one');
    expect(screen.queryByText('复制邀请链接')).toBeNull();
    expect(screen.queryByAltText('设备邀请二维码')).toBeNull();
  });
  it('lists a pending session invitation after reopening device management', async () => {
    const onRevokeInvitation = vi.fn().mockResolvedValue(undefined);
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onRevokeInvitation={onRevokeInvitation} sessions={[{ sessionId: 'backend-one', sourceSessionId: 'stable-one', name: '构建任务' }]} invitations={[
      { id: 'pending', scope: { kind: 'sessions', sessionIds: ['stable-one'] }, actions: ['session.view', 'session.input'], createdAt: Date.now(), invitationExpiresAt: Date.now() + 600000 },
    ]} />);
    fireEvent.click(screen.getByRole('tab', { name: /设备/ }));
    expect(screen.getByText('可操作 · 构建任务')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销邀请' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤销邀请' }));
    await waitFor(() => expect(onRevokeInvitation).toHaveBeenCalledWith('pending'));
  });
  it('revokes only the chosen session authorization from device details', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    render(<FederationAccess paired currentIdentity="owner" onConnect={() => {}} onClose={() => {}} onRevoke={onRevoke} sessions={[{ sessionId: 'backend-one', sourceSessionId: 'stable-one', name: '构建任务' }]} grants={[
      { id: 'session-write', subjectId: 'phone', scope: { kind: 'sessions', sessionIds: ['stable-one'] }, actions: ['session.view', 'session.input'] },
      { id: 'other-read', subjectId: 'phone', scope: { kind: 'sessions', sessionIds: ['two'] }, actions: ['session.view'] },
    ]} />);
    fireEvent.click(screen.getByRole('tab', { name: /设备/ }));
    fireEvent.click(screen.getByRole('button', { name: '授权详情' }));
    expect(screen.getByText('构建任务')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '撤销此项授权' })[0]);
    expect(onRevoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销此项授权' }));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledExactlyOnceWith('session-write'));
  });
  it('opens device details separately and saves a recognizable name', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onRename={onRename} onRevoke={async () => {}} grants={[{ id: 'one', subjectId: 'other', scope: { kind: 'service' }, actions: ['session.view'] }]} />);
    fireEvent.click(screen.getByRole('tab', { name: /设备/ }));
    expect(screen.getByText('未命名设备')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '授权详情' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { name: '授权详情' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回设备' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名 未命名设备' }));
    fireEvent.change(screen.getByRole('textbox', { name: '设备名称' }), { target: { value: '办公室电脑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('other', '办公室电脑'));
    await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
  });

  it('shows the current service once and separates device management from switching services', async () => {
    localStorage.setItem('termdock.federation.connections.v1', JSON.stringify([{ url: 'https://c.example', targetPeerId: serviceId, serviceName: '工作电脑' }]));
    render(<FederationAccess paired currentServiceId={serviceId} currentServiceName="工作电脑" currentIdentity="this-phone" onConnect={() => {}} onClose={() => {}} grants={[
      { id: 'mine', subjectId: 'this-phone', scope: { kind: 'service' }, actions: ['service:*'] },
      { id: 'old', subjectId: 'test-old', label: '旧测试设备', scope: { kind: 'service' }, actions: ['session.view'], revokedAt: 1 },
    ]} />);
    await screen.findByRole('button', { name: '当前服务 工作电脑' });
    expect(screen.getAllByText('工作电脑')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '连接' })).toBeNull();
    expect(screen.queryByText('此设备')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /设备/ }));
    expect(screen.getByText('此设备')).toBeTruthy();
    expect(screen.getByText('已失效的授权（1）').closest('details')?.open).toBe(false);
    expect(screen.queryByRole('button', { name: /撤销/ })).toBeNull();
  });
  it('groups a device grants and asks before revoking all its active access', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    render(<FederationAccess paired currentIdentity="this-phone" onConnect={() => {}} onClose={() => {}} onRevoke={onRevoke} grants={[
      { id: 'read', subjectId: 'other-device', label: '工作电脑', scope: { kind: 'service' }, actions: ['session.view'] },
      { id: 'write', subjectId: 'other-device', label: '工作电脑', scope: { kind: 'sessions', sessionIds: ['one'] }, actions: ['session.input'] },
    ]} />);
    fireEvent.click(screen.getByRole('tab', { name: /设备/ }));
    expect(screen.getAllByText('工作电脑')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '撤销 工作电脑 的访问权限' }));
    expect(onRevoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(2));
    expect(onRevoke.mock.calls.map(call => call[0])).toEqual(['read', 'write']);
  });
  it('cancels terminal selection without changing the invitation draft or closing its parent', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    const onClose = vi.fn();
    render(<FederationAccess paired onConnect={() => {}} onClose={onClose} onCreateInvite={onCreateInvite} sessions={[{ sessionId: 'one', name: '构建任务' }]} />);
    fireEvent.click(screen.getByText('邀请设备'));
    fireEvent.click(screen.getByRole('radio', { name: /可操作/ }));
    fireEvent.click(screen.getByRole('button', { name: /选择终端|已选/ }));
    fireEvent.click(screen.getByLabelText('构建任务'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('radio', { name: /可操作/ }) as HTMLInputElement).checked).toBe(true);
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ viewMode: 'chat', scope: { kind: 'sessions', sessionIds: ['one'] }, actions: ['session.view', 'session.input', 'session.resize'] }));
  });
  it('shows one input and keeps identity, JSON and authorization forms out of first use', () => {
    render(<FederationAccess onConnect={() => {}} onClose={() => {}} currentIdentity="private-peer-id" onGrant={() => {}} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByLabelText('服务地址或邀请链接')).toBeTruthy();
    expect(screen.queryByText('private-peer-id')).toBeNull();
    expect(screen.queryByLabelText('手动连接 JSON')).toBeNull();
    expect(screen.queryByText('邀请设备')).toBeNull();
  });
  it.each([
    ['INVITATION_EXPIRED', '邀请已过期'], ['INVITATION_USED', '邀请已被使用'],
    ['PAIRING_DENIED', '邀请已失效'], ['ROUTE_INVITATION_EXPIRED', '邀请已过期'],
    ['ROUTE_INVITATION_USED', '邀请已被使用'], ['ROUTE_PAIRING_DENIED', '邀请已失效'],
  ])('explains %s and replaces the failed invitation without submitting it again', async (failure, title) => {
    const onConnect = vi.fn().mockRejectedValueOnce(new Error(failure)).mockResolvedValue(undefined);
    render(<FederationAccess onConnect={onConnect} onClose={() => {}} initialInvite={{ url: 'https://c.example', targetPeerId: serviceId, pairingCode: code, serviceName: '工作电脑' }} />);
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '接受邀请' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重试连接' })).toBeNull();
    expect(screen.queryByText(/请检查网络/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '输入新的邀请链接' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    const fresh = 'n'.repeat(43);
    fireEvent.change(await screen.findByRole('textbox', { name: '新的邀请链接' }), { target: { value: createInviteLink({ v: 1, serviceId, code: fresh, entryUrl: 'https://c.example' }) } });
    fireEvent.click(screen.getByRole('button', { name: '接受新邀请' }));
    await waitFor(() => expect(onConnect).toHaveBeenLastCalledWith(expect.objectContaining({ pairingCode: fresh })));
    expect(JSON.stringify(localStorage)).not.toContain(code);
    expect(JSON.stringify(localStorage)).not.toContain(fresh);
  });
  it('validates and cancels a replacement link without redeeming or retaining its draft', async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error('INVITATION_EXPIRED'));
    render(<FederationAccess onConnect={onConnect} onClose={() => {}} initialInvite={{ url: 'https://c.example', targetPeerId: serviceId, pairingCode: code }} />);
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));
    fireEvent.click(await screen.findByRole('button', { name: '输入新的邀请链接' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新的邀请链接' }), { target: { value: '不完整的链接' } });
    fireEvent.click(screen.getByRole('button', { name: '接受新邀请' }));
    expect(await screen.findByText('请输入完整的 Termdock 邀请链接。')).toBeTruthy();
    expect(onConnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '返回邀请' }));
    expect(screen.getByRole('heading', { name: '邀请已过期' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '输入新的邀请链接' }));
    expect((screen.getByRole('textbox', { name: '新的邀请链接' }) as HTMLInputElement).value).toBe('');
  });
  it('keeps connection failures retryable without claiming the invitation expired', async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error('Secure transport unavailable'));
    render(<FederationAccess onConnect={onConnect} onClose={() => {}} initialInvite={{ url: 'https://c.example', targetPeerId: serviceId, pairingCode: code }} />);
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));
    expect(await screen.findByRole('heading', { name: '暂时无法连接' })).toBeTruthy();
    expect(screen.queryByText('邀请已过期')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(2));
  });
  it('accepts a named invitation with one button and no input', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const invitation = { url: 'https://c.example', targetPeerId: serviceId, pairingCode: code, serviceName: '工作电脑' };
    render(<FederationAccess onConnect={onConnect} onClose={() => {}} initialInvite={invitation} />);
    expect(screen.getByText('工作电脑')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByText('接受邀请'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(invitation));
  });
  it('takes trusted identity from invitation and never persists its secret', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(<FederationAccess onConnect={onConnect} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('服务地址或邀请链接'), { target: { value: inviteUrl } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ targetPeerId: serviceId, pairingCode: code, url: 'https://c.example', serviceOrigin: 'https://c.example', serviceName: '工作电脑' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已连接'));
    const saved = localStorage.getItem('termdock.federation.connections.v1');
    expect(saved || '').not.toContain(code); expect(saved || '').not.toContain('pairingCode');
  });
  it('does not save failed invitations or echo errors containing secrets', async () => {
    render(<FederationAccess onConnect={async () => { throw new Error(code); }} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('服务地址或邀请链接'), { target: { value: inviteUrl } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法连接'));
    expect(screen.getByRole('alert').textContent).not.toContain(code);
    expect(localStorage.getItem('termdock.federation.connections.v1')).toBeNull();
  });
  it('generates read-only invitations with no device identity entry', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired currentServiceName="工作电脑" onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByText('邀请设备'));
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ viewMode: 'chat', scope: { kind: 'service' }, actions: ['session.view'] }));
    await waitFor(() => expect(screen.getByText('复制邀请链接')).toBeTruthy());
    expect(localStorage.getItem('termdock.federation.connections.v1')).toBeNull();
  });
  it('selects actual named Sessions and keeps termination out of normal write access', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} sessions={[{ sessionId: 'backend-1', name: '构建任务' }, { sessionId: 'backend-2', name: '代码审查' }]} />);
    fireEvent.click(screen.getByText('邀请设备')); fireEvent.click(screen.getByRole('radio', { name: /可操作/ }));
    fireEvent.click(screen.getByRole('button', { name: /选择终端|已选/ }));
    if (!(screen.getByLabelText('构建任务') as HTMLInputElement).checked) fireEvent.click(screen.getByLabelText('构建任务')); fireEvent.click(screen.getByRole('button', { name: '使用所选终端（1）' })); allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ viewMode: 'chat', scope: { kind: 'sessions', sessionIds: ['backend-1'] }, actions: ['session.view', 'session.input', 'session.resize'] }));
  });
  it('uses service wildcard only when explicitly selected', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
    fireEvent.click(screen.getByText('邀请设备')); more(); fireEvent.click(screen.getByRole('checkbox', { name: '授予完整服务权限' })); allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ viewMode: 'chat', scope: { kind: 'service' }, actions: ['service:*'] }));
  });
  it('grants the stable client session id for a selected session so a backend replacement keeps it valid', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} sessions={[{ sessionId: 'backend-1', sourceSessionId: 'stable-1', name: '构建任务' }]} />);
    fireEvent.click(screen.getByText('邀请设备'));
    fireEvent.click(screen.getByRole('radio', { name: /可操作/ }));
    fireEvent.click(screen.getByRole('button', { name: /选择终端|已选/ }));
    expect((screen.getByLabelText('构建任务') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '使用所选终端（1）' }));
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'sessions', sessionIds: ['stable-1'] } })));
  });
  it('lets the inviter pick an accessible IP entry address for the invitation', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired currentServiceOrigin="https://dv4d.termdock.local:9834" onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} inviteAddresses={[{ url: 'https://192.168.1.23:9834', label: 'Wi-Fi' }]} />);
    fireEvent.click(screen.getByText('邀请设备'));

    expect(screen.getByRole('combobox', { name: '接入地址' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('接入地址'), { target: { value: 'https://192.168.1.23:9834' } });
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ entryAddress: 'https://192.168.1.23:9834' })));
  });
  it('defaults local-client invitations to the supplied IP while keeping mDNS available as an explicit choice', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired currentServiceOrigin="https://127.0.0.1:9834" onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} inviteAddresses={[
      { url: 'https://dv4d.termdock.local:9834', label: '服务域名' },
      { url: 'https://192.168.1.23:9834', label: 'Wi-Fi' },
    ]} />);
    fireEvent.click(screen.getByText('邀请设备'));
    expect((screen.getByLabelText('接入地址') as HTMLSelectElement).value).toBe('https://192.168.1.23:9834');
    expect(screen.getByRole('option', { name: /dv4d.termdock.local/ })).toBeTruthy();
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ entryAddress: 'https://192.168.1.23:9834' })));
  });
  it('validates a manually entered entry address before generating the invitation', async () => {
    const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
    render(<FederationAccess paired onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} inviteAddresses={[{ url: 'https://192.168.1.23:9834', label: 'Wi-Fi' }]} />);
    fireEvent.click(screen.getByText('邀请设备'));

    fireEvent.change(screen.getByRole('combobox', { name: '接入地址' }), { target: { value: 'custom' } });
    fireEvent.change(screen.getByPlaceholderText('例如：https://192.168.1.23:9834'), { target: { value: 'ftp://192.168.1.23' } });
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('接入地址'));
    expect(onCreateInvite).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('例如：https://192.168.1.23:9834'), { target: { value: 'https://10.0.0.8:9834' } });
    allWhenEmpty();
    fireEvent.click(screen.getByText('生成并复制链接'));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ entryAddress: 'https://10.0.0.8:9834' })));
  });
});

it('always offers a custom invite address and warns that localhost is local to one computer', async () => {
  const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
  render(<FederationAccess paired currentServiceOrigin="https://localhost:9881" onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
  fireEvent.click(screen.getByText('邀请设备'));
  expect(screen.getByRole('combobox', { name: '接入地址' }).textContent).toContain('localhost:9881');
  expect(screen.getByText(/当前地址仅供这台电脑使用/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '接入地址' }), { target: { value: 'custom' } });
  fireEvent.change(screen.getByPlaceholderText('例如：https://192.168.1.23:9834'), { target: { value: 'https://[::1]:9881' } });
  fireEvent.click(screen.getByRole('radio', { name: '全部终端' }));
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ viewMode: 'chat', entryAddress: 'https://[::1]:9881', scope: { kind: 'service' }, actions: ['session.view'] }));
});

it('preselects all requested stable Session identities and preserves split presentation in the invitation', async () => {
  const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
  render(<FederationAccess paired initialShareSessionIds={['stable-one', 'stable-two']} initialViewLayout="split" sessions={[{ sessionId: 'backend-one', sourceSessionId: 'stable-one', name: 'One' }, { sessionId: 'backend-two', sourceSessionId: 'stable-two', name: 'Two' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'sessions', sessionIds: ['stable-one', 'stable-two'] }, viewLayout: 'split' })));
  expect(await screen.findByText(/HTTP 入口无需安装证书/)).toBeTruthy();
});
it('does not silently omit unavailable or remote members from a group share', () => {
  const onCreateInvite = vi.fn();
  render(<FederationAccess paired initialShareSessionIds={['stable-one', 'remote:unknown:two']} sessions={[{ sessionId: 'one', sourceSessionId: 'stable-one', name: 'One' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  expect(onCreateInvite).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('跨服务');
});

it('generates and copies the selected Session in one action without expanding options', async () => {
  document.documentElement.style.setProperty('--background', '#100F0F');
  document.documentElement.style.setProperty('--foreground', '#CECDC3');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const create = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
  render(<FederationAccess paired initialShareSessionId="stable" initialViewMode="terminal" sessions={[{ sessionId: 'backend', sourceSessionId: 'stable', name: '构建任务' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={create} />);
  expect(screen.getByRole('button', { name: /更多选项/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('combobox', { name: '访问有效期' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '接入地址' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  await screen.findByText('链接已复制');
  expect(create).toHaveBeenCalledExactlyOnceWith({ viewMode: 'terminal', scope: { kind: 'sessions', sessionIds: ['stable'] }, actions: ['session.view'] });
  expect(writeText).toHaveBeenCalledExactlyOnceWith(inviteUrl);
  expect((screen.getByRole('textbox', { name: '分享链接' }) as HTMLInputElement).value).toBe(inviteUrl);
  expect(screen.queryByAltText('设备邀请二维码')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '显示二维码' }));
  expect(await screen.findByAltText('设备邀请二维码')).toBeTruthy();
  Reflect.deleteProperty(navigator, 'clipboard');
});
it('keeps a generated link available after clipboard denial and retries copy without creating a second invitation', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const create = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000 });
  render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: 'One' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={create} />);
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  await screen.findByText(/未能自动复制/);
  fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }));
  await screen.findByText('链接已复制');
  expect(create).toHaveBeenCalledOnce();
  Reflect.deleteProperty(navigator, 'clipboard');
});
it('suggests an available address for localhost while respecting an explicitly chosen address as inventory refreshes', () => {
  const props = { paired: true, currentServiceOrigin: 'https://localhost:9834', onConnect: () => {}, onClose: () => {} };
  const view = render(<FederationAccess {...props} initialShareSessionId="one" sessions={[{ sessionId: 'one', name: 'One' }]} />);
  view.rerender(<FederationAccess {...props} initialShareSessionId="one" sessions={[{ sessionId: 'one', name: 'One' }]} inviteAddresses={[{ url: 'https://192.168.8.2:9834', label: 'LAN' }]} />);
  expect((screen.getByLabelText('接入地址') as HTMLSelectElement).value).toBe('https://192.168.8.2:9834');
  fireEvent.change(screen.getByLabelText('接入地址'), { target: { value: '' } });
  view.rerender(<FederationAccess {...props} initialShareSessionId="one" sessions={[{ sessionId: 'one', name: 'One' }]} inviteAddresses={[{ url: 'https://192.168.8.3:9834', label: 'LAN' }]} />);
  expect((screen.getByLabelText('接入地址') as HTMLSelectElement).value).toBe('');
});

it('explains certificate setup and exposes the fingerprint to the sharer', async () => {
  const onCreateInvite = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: Date.now() + 600000, certificateFingerprint: 'AA:BB:CC' });
  render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '演示会话' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={onCreateInvite} />);
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  expect(await screen.findByText(/接收方可直接接受邀请/)).toBeTruthy();
  expect(screen.getByText('向接收方核对证书指纹')).toBeTruthy();
  expect(screen.getByText('AA:BB:CC')).toBeTruthy();
});

 it('skips transport guidance when disabled and redeems only on explicit acceptance', async () => {
  const original = createInviteLink({ v: 1, serviceId, code, entryUrl: 'https://192.168.1.20:9834', showAccessGuide: false });
  const invitation = parseInviteLink(createOnboardingInviteLink(original, 'http://192.168.1.20:21000/connect'), { httpTransport: true });
  const onConnect = vi.fn().mockResolvedValue(undefined);
  render(<FederationAccess initialInvite={invitation} onConnect={onConnect} onClose={() => {}} />);
  expect(screen.queryByRole('link', { name: /HTTPS 打开/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /HTTP 打开/ })).toBeNull();
  expect(screen.queryByText('不想看到证书提示？')).toBeNull();
  expect(onConnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));
  await waitFor(() => expect(onConnect).toHaveBeenCalledExactlyOnceWith(invitation));
 });
 it('lets the sharer disable guidance without changing the granted scope or actions', async () => {
  const create = vi.fn().mockResolvedValue({ url: inviteUrl, expiresAt: null });
  render(<FederationAccess paired initialShareSessionId="one" sessions={[{ sessionId: 'one', name: '产品开发' }]} onConnect={() => {}} onClose={() => {}} onCreateInvite={create} />);
  const toggle=screen.getByRole('checkbox', { name: /显示访问方式引导/ });
  expect((toggle as HTMLInputElement).checked).toBe(true);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '生成并复制链接' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0][0]).toMatchObject({ showAccessGuide: false, scope: { kind: 'sessions', sessionIds: ['one'] }, actions: ['session.view'] });
 });
