import { expect, test, type Page, type Route } from '@playwright/test';
import type { UiState } from '../src/lib/types';

function state(vpnStatus: string, vpnEnabled = false): UiState {
  return {
    platform: 'linux', mobile: false, vpnControlSupported: true,
    cliInstallSupported: false, startupSettingsSupported: false, trayBehaviorSupported: false,
    runtimeStatusDetail: '', daemonRunning: true, vpnEnabled, vpnActive: vpnEnabled,
    cliInstalled: false, serviceSupported: true, serviceEnablementSupported: true,
    serviceInstalled: true, serviceDisabled: false, serviceRunning: true, serviceStatusDetail: '',
    vpnStatus, appVersion: 'test', daemonBinaryVersion: 'test', configPath: '',
    ownNpub: '', ownPubkeyHex: '', networkId: 'test', joinRequestQrCodeOrLink: '',
    nodeId: 'test', nodeName: 'Test device', selfMagicDnsName: 'test.nvpn',
    endpoint: '', tunnelIp: '', listenPort: 51820, relays: [], nostrPubsubMode: 'relay',
    nostrPubsubFanout: 4, nostrPubsubMaxHops: 2, nostrPubsubMaxEventBytes: 65536,
    exitNode: '', internetSource: 'direct', exitNodeLeakProtection: false,
    exitNodeActive: false, exitNodeBlocked: false, exitNodeStatusText: '',
    advertiseExitNode: false, advertisedRoutes: [], effectiveAdvertisedRoutes: [],
    wireguardExitEnabled: false, wireguardExitConfigured: false,
    wireguardExitEndpoint: '', wireguardExitConfig: '', fipsHostTunnelEnabled: false,
    connectToNonRosterFipsPeers: true, fipsNostrDiscoveryEnabled: true,
    fipsWebrtcEnabled: false, fipsBootstrapEnabled: false, fipsBootstrapPeers: {},
    fipsBootstrapPeerDefaults: {}, fipsHostInboundTcpPorts: '', magicDnsSuffix: 'nvpn',
    magicDnsStatus: '', autoconnect: false, launchOnStartup: false, closeToTrayOnClose: false,
    connectedPeerCount: 0, expectedPeerCount: 0, fipsConnectedPeerCount: 0,
    fipsRosterPeerCount: 0, nonFipsRosterPeerCount: 0, meshReady: false, health: [],
    network: {}, portMapping: { upnp: { state: '' }, natPmp: { state: '' }, pcp: { state: '' } },
    networks: [{
      id: 'test', name: 'Test network', enabled: true, networkId: 'test', localIsAdmin: true,
      adminNpubs: [], joinRequestsEnabled: false, joinRequestAdminNpub: '',
      inboundJoinRequests: [], onlineCount: 0, expectedCount: 0, participants: [],
    }],
  };
}

async function controlledApi(page: Page) {
  const polls: Route[] = [];
  const actions: Route[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/tick') {
      polls.push(route);
    } else {
      expect(['/api/connect_vpn', '/api/update_settings']).toContain(new URL(route.request().url()).pathname);
      actions.push(route);
    }
  });
  // Observe body consumption so assertions cannot pass before a stale reply is processed.
  await page.addInitScript(() => {
    const json = Response.prototype.json;
    Response.prototype.json = async function () {
      const body = await json.call(this);
      document.documentElement.dataset.apiResponsesRead = String(
        Number(document.documentElement.dataset.apiResponsesRead ?? 0) + 1,
      );
      return body;
    };
  });
  const now = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.goto('/');
  await expect.poll(() => polls.length).toBe(1);

  let replies = 0;
  async function reply(route: Route, body: UiState | string) {
    await route.fulfill({
      status: typeof body === 'string' ? 503 : 200,
      json: typeof body === 'string' ? { error: body } : body,
    });
    await expect(page.locator('html')).toHaveAttribute('data-api-responses-read', String(++replies));
    expect(pageErrors).toEqual([]);
  }
  async function poll() {
    const count = polls.length;
    await page.clock.runFor(2500);
    await expect.poll(() => polls.length).toBe(count + 1);
    return polls[count];
  }
  async function connect() {
    const count = actions.length;
    await page.getByRole('button', { name: 'Turn VPN on' }).click();
    await expect.poll(() => actions.length).toBe(count + 1);
    return actions[count];
  }
  return { polls, actions, reply, poll, connect };
}

for (const staleFails of [false, true]) {
  const staleResult = staleFails ? 'failure' : 'success';

  test(`late poll ${staleResult} cannot overwrite a successful action`, async ({ page }) => {
    const api = await controlledApi(page);
    await api.reply(api.polls[0], state('VPN off'));
    const stale = await api.poll();
    const action = await api.connect();
    await api.reply(action, state('VPN on', true));
    await expect(page.getByRole('button', { name: 'Turn VPN off' })).toBeEnabled();

    await api.reply(stale, staleFails ? 'Old poll failed' : state('Stale VPN off'));
    await expect(page.locator('.header-vpn-text')).toHaveText('VPN on');
    await expect(page.getByRole('button', { name: 'Turn VPN off' })).toBeEnabled();
    await expect(page.locator('.notice-row.error')).toHaveCount(0);

    await api.reply(await api.poll(), state('Fresh VPN status', true));
    await expect(page.locator('.header-vpn-text')).toHaveText('Fresh VPN status');
  });

  test(`action errors survive late poll ${staleResult} and normal polling`, async ({ page }) => {
    const api = await controlledApi(page);
    await api.reply(api.polls[0], state('VPN off'));
    const stale = await api.poll();
    await api.reply(await api.connect(), 'Unable to connect');
    await expect(page.locator('.notice-row.error')).toHaveText('Unable to connect');

    await api.reply(stale, staleFails ? 'Old poll failed' : state('Stale VPN off'));
    await expect(page.locator('.header-vpn-text')).toHaveText('VPN off');
    await expect(page.locator('.notice-row.error')).toHaveText('Unable to connect');

    await api.reply(await api.poll(), 'Current poll failed');
    await expect(page.locator('.notice-row.error')).toHaveText('Unable to connect');
    await api.reply(await api.poll(), state('Fresh VPN status'));
    await expect(page.locator('.header-vpn-text')).toHaveText('Fresh VPN status');
    await expect(page.locator('.notice-row.error')).toHaveText('Unable to connect');

    await api.reply(await api.connect(), state('VPN on', true));
    await expect(page.locator('.header-vpn-text')).toHaveText('VPN on');
    await expect(page.locator('.notice-row.error')).toHaveCount(0);
  });

  for (const newerFails of [false, true]) {
    test(`late initial poll ${staleResult} cannot replace newer poll ${newerFails ? 'failure' : 'success'}`, async ({ page }) => {
      const api = await controlledApi(page);
      const newer = await api.poll();
      await api.reply(newer, newerFails ? 'Latest poll failed' : state('Latest VPN status'));
      await api.reply(api.polls[0], staleFails ? 'Old poll failed' : state('Stale VPN off'));

      if (newerFails) {
        await expect(page.locator('.center-state.error-state')).toHaveText('Latest poll failed');
        await expect(page.locator('.header-vpn-text')).toHaveCount(0);
      } else {
        await expect(page.locator('.header-vpn-text')).toHaveText('Latest VPN status');
        await expect(page.locator('.notice-row.error')).toHaveCount(0);
      }

      await api.reply(await api.poll(), state('Recovered VPN status'));
      await expect(page.locator('.header-vpn-text')).toHaveText('Recovered VPN status');
      await expect(page.locator('.notice-row.error')).toHaveCount(0);
    });
  }
}

test('polling makes progress while newer polls are pending and recovers after errors', async ({ page }) => {
  const api = await controlledApi(page);
  const pending = await api.poll();
  await api.reply(api.polls[0], state('Initial VPN status'));
  await expect(page.locator('.header-vpn-text')).toHaveText('Initial VPN status');
  await api.reply(pending, 'Poll failed');
  await expect(page.locator('.notice-row.error')).toHaveText('Poll failed');

  await api.reply(await api.poll(), state('Recovered VPN status'));
  await expect(page.locator('.header-vpn-text')).toHaveText('Recovered VPN status');
  await expect(page.locator('.notice-row.error')).toHaveCount(0);
});

for (const editor of ['settings', 'WireGuard', 'WireGuard import'] as const) {
  for (const fails of [false, true]) {
    test(`${editor} preserves newer edits after a save ${fails ? 'failure' : 'success'}`, async ({ page }, testInfo) => {
      const api = await controlledApi(page);
      await api.reply(api.polls[0], state('VPN off'));
      const settings = editor === 'settings';
      await page.getByRole('button', { name: settings ? 'Settings' : 'Exit Nodes', exact: true }).click();
      const form = settings ? page.locator('.settings-form') : page.locator('form').filter({
        has: page.getByRole('heading', { name: 'WireGuard Upstream' }),
      });
      const field = form.getByLabel(settings ? 'Name' : 'Config', { exact: true });
      const save = form.getByRole('button', { name: settings ? 'Save settings' : 'Save', exact: true });
      const submitted = settings ? '  Device A  ' : '# Config A';
      const edited = settings ? 'Device B' : '# Config B';
      if (editor === 'WireGuard import') {
        await form.locator('input[type="file"]').setInputFiles({
          name: 'test.conf', mimeType: 'text/plain', buffer: Buffer.from(submitted),
        });
      } else {
        await field.fill(submitted);
        await save.click();
      }
      await expect.poll(() => api.actions.length).toBe(1);
      expect(api.actions[0].request().postDataJSON()[settings ? 'nodeName' : 'wireguardExitConfig']).toBe(submitted);
      await expect(save).toBeDisabled();
      await field.fill(edited);

      const savedState = {
        ...state('Saved'), nodeName: 'Device A', wireguardExitConfigured: true,
      };
      await api.reply(api.actions[0], fails ? 'Save failed' : savedState);
      await expect(field).toHaveValue(edited);
      await expect(save).toBeEnabled();
      if (fails) await expect(page.locator('.notice-row.error')).toHaveText('Save failed');

      await api.reply(await api.poll(), { ...savedState, vpnStatus: 'Fresh poll' });
      await expect(page.locator('.header-vpn-text')).toHaveText('Fresh poll');
      await expect(field).toHaveValue(edited);
      await expect(save).toBeEnabled();
      if (!fails) {
        await page.setViewportSize({ width: 1280, height: 1800 });
        await form.screenshot({ path: testInfo.outputPath('retained-draft.png') });
      }

      // An untouched retry accepts the server's normalized (or hidden) value.
      await save.click();
      await expect.poll(() => api.actions.length).toBe(2);
      expect(api.actions[1].request().postDataJSON()[settings ? 'nodeName' : 'wireguardExitConfig']).toBe(edited);
      await api.reply(api.actions[1], { ...savedState, nodeName: 'Normalized Device B' });
      await expect(field).toHaveValue(settings ? 'Normalized Device B' : '');
      await expect(save).toBeDisabled();
      await expect(page.locator('.notice-row.error')).toHaveCount(0);
      await api.reply(await api.poll(), { ...savedState, nodeName: 'Polled device' });
      await expect(field).toHaveValue(settings ? 'Polled device' : '');
      await expect(save).toBeDisabled();
    });
  }
}

test('WireGuard file reading does not replace edits made while the import is pending', async ({ page }) => {
  await page.addInitScript(() => {
    const text = File.prototype.text;
    File.prototype.text = async function () {
      const value = await text.call(this);
      document.documentElement.dataset.fileReadPending = 'true';
      await new Promise<void>((resolve) => document.addEventListener('finish-file-read', () => resolve(), { once: true }));
      document.documentElement.dataset.fileReadReady = 'true';
      return value;
    };
  });
  const api = await controlledApi(page);
  await api.reply(api.polls[0], state('VPN off'));
  await page.getByRole('button', { name: 'Exit Nodes', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'WireGuard Upstream' }) });
  const field = form.getByLabel('Config', { exact: true });
  const save = form.getByRole('button', { name: 'Save', exact: true });
  const input = form.locator('input[type="file"]');
  await input.setInputFiles({ name: 'test.conf', mimeType: 'text/plain', buffer: Buffer.from('# Imported config') });
  await expect(page.locator('html')).toHaveAttribute('data-file-read-pending', 'true');
  await field.fill('# Newer edit');
  await page.evaluate(() => document.dispatchEvent(new Event('finish-file-read')));
  await expect(page.locator('html')).toHaveAttribute('data-file-read-ready', 'true');
  await expect(field).toHaveValue('# Newer edit');
  await expect(input).toHaveValue('');
  await expect(save).toBeEnabled();
  expect(api.actions).toHaveLength(0);
  await api.reply(await api.poll(), state('Fresh poll'));
  await expect(field).toHaveValue('# Newer edit');
  await expect(save).toBeEnabled();
});
