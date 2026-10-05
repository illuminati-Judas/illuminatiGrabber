const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

async function worker({ completeImmediately = false, nativeHandler, initialStored = {} } = {}) {
  const stored = structuredClone(initialStored);
  const downloads = new Map();
  const shown = [];
  let nextId = 0;
  let failWrite = false;
  const context = vm.createContext({
    URL, crypto: { randomUUID }, console, setTimeout,
    chrome: {
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => {},
        connectNative: () => {
          let onMessage;
          return {
            onMessage: { addListener(fn) { onMessage = fn; } },
            onDisconnect: { addListener() {} },
            postMessage(payload) { nativeHandler?.(payload, onMessage); },
            disconnect() {},
          };
        },
      },
      storage: { local: {
        get: async (defaults) => structuredClone({ ...defaults, ...stored }),
        set: async (values) => {
          if (failWrite) { failWrite = false; throw new Error('Temporary storage failure'); }
          Object.assign(stored, structuredClone(values));
        },
      } },
      downloads: {
        onChanged: { addListener() {} },
        download: async (options) => {
          const id = ++nextId;
          downloads.set(id, { id, ...options, bytesReceived: completeImmediately ? 100 : 0, totalBytes: 100, state: completeImmediately ? 'complete' : 'in_progress' });
          return id;
        },
        search: async ({ id } = {}) => Number.isInteger(id)
          ? (downloads.has(id) ? [structuredClone(downloads.get(id))] : [])
          : [...downloads.values()].map((item) => structuredClone(item)),
        show: async (id) => { shown.push(id); },
      },
    },
  });
  const root = path.resolve(__dirname, '..');
  context.importScripts = (...files) => files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.resolve(root, 'background', file), 'utf8'), context);
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8'), context);
  await context.ensureDownloadQueueReady();
  return { context, downloads, shown, failNextWrite() { failWrite = true; } };
}

const items = Array.from({ length: 3 }, (_, i) => ({ url: `https://cdn.test/photo-${i}.jpg`, type: 'image', downloadIndex: i + 1 }));

test('queue limits concurrency and starts the next file after completion', async () => {
  const { context, downloads } = await worker();
  const result = await context.downloadMedia({ items });
  assert.equal(result.queued, 3);
  assert.equal(downloads.size, 2);
  let view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.filter((job) => job.status === 'waiting').length, 1);
  assert.ok(view.jobs.every((job) => !job.request && !job.launch));
  await context.applyDownloadChange({ id: 1, state: { current: 'complete' } });
  view = await context.getPublicDownloadJobs();
  assert.equal(downloads.size, 3);
  assert.equal(view.jobs.filter((job) => job.status === 'completed').length, 1);
  assert.equal(view.jobs.filter((job) => job.status === 'downloading').length, 2);
});

test('reads live byte progress without an onChanged event and recovers a missed completion', async () => {
  const { context, downloads } = await worker();
  await context.downloadMedia({ items });
  downloads.get(1).bytesReceived = 55;
  let view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.find((job) => job.downloadId === 1).progressPercent, 55);
  downloads.get(1).state = 'complete';
  view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.find((job) => job.downloadId === 1).status, 'completed');
  assert.equal(downloads.size, 3);
});

test('unknown total shows no fabricated percentage and Retry/Cancel obey state', async () => {
  const { context, downloads } = await worker();
  const result = await context.downloadMedia({ items });
  downloads.get(1).bytesReceived = 55;
  downloads.get(1).totalBytes = -1;
  let view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.find((job) => job.downloadId === 1).progressPercent, null);
  assert.equal((await context.cancelDownloadJob(result.jobIds[0])).ok, false);
  assert.equal((await context.retryDownloadJob(result.jobIds[0])).ok, false);
  assert.equal((await context.cancelDownloadJob(result.jobIds[2])).ok, true);
  downloads.get(1).state = 'interrupted';
  downloads.get(1).error = 'NETWORK_FAILED';
  await context.getPublicDownloadJobs();
  assert.equal((await context.retryDownloadJob(result.jobIds[0])).ok, true);
  view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.find((job) => job.id === result.jobIds[0]).attempt, 2);
});

test('native downloads share queue states and can retry a failed request', async () => {
  const callbacks = [];
  const { context } = await worker({ nativeHandler: (_payload, callback) => callbacks.push(callback) });
  const result = await context.queueSmartDownload({ kind: 'native', payload: { command: 'download_x', url: 'https://x.com/person/status/123' } });
  assert.equal(result.queued, 1);
  await new Promise(setImmediate);
  let view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs[0].status, 'downloading');
  assert.equal(view.jobs[0].progressPercent, null);
  assert.equal(view.jobs[0].request, undefined);
  callbacks.shift()({ ok: false, error: 'network unavailable' });
  await new Promise(setImmediate);
  assert.equal((await context.getPublicDownloadJobs()).jobs[0].status, 'failed');
  await context.retryDownloadJob(result.jobIds[0]);
  await new Promise(setImmediate);
  callbacks.shift()({ ok: true, output_dir: '/test/output' });
  await new Promise(setImmediate);
  view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs[0].status, 'completed');
  assert.equal(view.jobs[0].progressPercent, 100);
});

test('fast downloads complete even when the completion event precedes ID registration', async () => {
  const { context } = await worker({ completeImmediately: true });
  await context.downloadMedia({ items });
  const view = await context.getPublicDownloadJobs();
  assert.equal(view.jobs.filter((job) => job.status === 'completed').length, 3);
});

test('one storage failure does not poison all later queue operations', async () => {
  const { context, failNextWrite } = await worker();
  failNextWrite();
  await assert.rejects(context.downloadMedia({ items: items.slice(0, 1) }), /storage failure/);
  const result = await context.downloadMedia({ items: items.slice(0, 1) });
  assert.equal(result.queued, 1);
});

test('Show in Finder uses only the exact Chrome download ID stored for the opaque record', async () => {
  const record = {
    id: 'telegram-record-safe-1234', status: 'success', source: 'telegram',
    type: 'video', filename: 'clip.mp4', completedAt: '2026-09-28T02:00:00.000Z', downloadId: 73,
  };
  const harness = await worker({ initialStored: { downloadHistory: [record] } });
  harness.downloads.set(73, { id: 73, state: 'complete', filename: '/Users/test/Downloads/clip.mp4' });

  const result = await harness.context.showRecordedDownload('telegram-record-safe-1234');

  assert.equal(result.ok, true);
  assert.deepEqual(harness.shown, [73]);
});

test('Show in Finder fails closed for unknown, unassociated, or incomplete records', async () => {
  const history = [
    { id: 'telegram-no-download-1234', status: 'success', downloadId: null },
    { id: 'telegram-incomplete-1234', status: 'success', downloadId: 74 },
  ];
  const harness = await worker({ initialStored: { downloadHistory: history } });
  harness.downloads.set(74, { id: 74, state: 'in_progress' });

  assert.equal((await harness.context.showRecordedDownload('telegram-missing-1234')).ok, false);
  assert.equal((await harness.context.showRecordedDownload('telegram-no-download-1234')).ok, false);
  assert.equal((await harness.context.showRecordedDownload('telegram-incomplete-1234')).ok, false);
  assert.deepEqual(harness.shown, []);
});

test('Show in Finder rejects a caller object that tries to override stored data', async () => {
  const record = { id: 'telegram-record-fixed-1234', status: 'success', downloadId: 75 };
  const harness = await worker({ initialStored: { downloadHistory: [record] } });
  harness.downloads.set(75, { id: 75, state: 'complete' });
  harness.downloads.set(999, { id: 999, state: 'complete' });

  const result = await harness.context.showRecordedDownload({
    id: 'telegram-record-fixed-1234', downloadId: 999, path: '/tmp/wrong-file',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(harness.shown, []);
});

test('history refresh repairs a record saved before Chrome assigned its download ID', async () => {
  const record = {
    id: 'telegram-repair-record-1234', status: 'success', type: 'video',
    filename: 'recovered.mp4', bytes: 321, completedAt: '2026-09-28T02:00:00.000Z',
  };
  const harness = await worker({ initialStored: { downloadHistory: [record], downloadUnread: 1 } });
  harness.downloads.set(88, {
    id: 88, state: 'complete', filename: '/Users/test/Downloads/recovered.mp4',
    totalBytes: 321, startTime: '2026-09-28T02:00:00.000Z',
  });

  const state = await harness.context.repairDownloadHistoryAssociations();

  assert.equal(state.downloadHistory[0].downloadId, 88);
  assert.equal(state.downloadHistory[0].actualFilename, 'recovered.mp4');
});

test('sparse completion reads authoritative bytes and records sanitized generic outcome', async () => {
  const { context, downloads } = await worker();
  await context.downloadMedia({ items: [items[0]] });
  Object.assign(downloads.get(1), { state: 'complete', bytesReceived: 106700, totalBytes: 106700 });
  await context.applyDownloadChange({ id: 1, state: { current: 'complete' } });
  const job = (await context.getPublicDownloadJobs()).jobs[0];
  assert.equal(job.bytesReceived, 106700);
  const history = (await context.repairDownloadHistoryAssociations()).downloadHistory;
  assert.equal(history.length, 1);
  assert.equal(history[0].source, 'generic');
  assert.equal(history[0].downloadId, 1);
  assert.equal(history[0].bytes, 106700);
  assert.ok(!JSON.stringify(history).includes('https://'));
});

test('history clear removes only terminal queue records and never resurrects them', async () => {
  const { context, downloads } = await worker();
  await context.downloadMedia({ items });
  Object.assign(downloads.get(1), { state: 'complete', bytesReceived: 100 });
  await context.applyDownloadChange({ id: 1, state: { current: 'complete' } });
  await context.clearDownloadHistory();
  const jobs = (await context.getPublicDownloadJobs()).jobs;
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((job) => job.status === 'downloading'));
  assert.equal(downloads.size, 3);
  assert.equal((await context.repairDownloadHistoryAssociations()).downloadHistory.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  Object.assign(downloads.get(2), { state: 'complete', bytesReceived: 100 });
  await context.applyDownloadChange({ id: 2, state: { current: 'complete' } });
  assert.equal((await context.repairDownloadHistoryAssociations()).downloadHistory.length, 1);
});

test('legacy completed queue bytes are repaired using Chrome metadata', async () => {
  const { context, downloads } = await worker({ completeImmediately: true });
  await context.downloadMedia({ items: [items[0]] });
  await context.mutateDownloadQueue((queue) => { queue.jobs[0].bytesReceived = 0; queue.jobs[0].totalBytes = 106700; });
  Object.assign(downloads.get(1), { bytesReceived: 106700, totalBytes: 106700 });
  assert.equal((await context.getPublicDownloadJobs()).jobs[0].bytesReceived, 106700);
  assert.equal((await context.repairDownloadHistoryAssociations()).downloadHistory[0].bytes, 106700);
});

test('forbidden URL fails with fresh scan advice and cannot blindly retry', async () => {
  const { context, downloads } = await worker();
  const { jobIds } = await context.downloadMedia({ items: [items[0]] });
  Object.assign(downloads.get(1), { state: 'interrupted', error: 'SERVER_FORBIDDEN' });
  await context.applyDownloadChange({ id: 1, state: { current: 'interrupted' }, error: { current: 'SERVER_FORBIDDEN' } });
  const result = await context.retryDownloadJob(jobIds[0]);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'FRESH_SCAN_REQUIRED');
  assert.match(result.error, /scan/i);
  assert.equal(downloads.size, 1);
  const history = (await context.repairDownloadHistoryAssociations()).downloadHistory;
  assert.equal(history[0].source, 'generic');
  assert.equal(history[0].status, 'failed');
});

test('concurrent history writes preserve both records and clear wins over repair', async () => {
  const { context } = await worker();
  const completedAt = new Date().toISOString();
  await Promise.all(['one', 'two'].map((id) => context.recordDownload({ id, source: 'generic', status: 'failed', completedAt })));
  assert.equal((await context.repairDownloadHistoryAssociations()).downloadHistory.length, 2);
  await Promise.all([context.repairDownloadHistoryAssociations(), context.clearDownloadHistory()]);
  assert.equal((await context.repairDownloadHistoryAssociations()).downloadHistory.length, 0);
});

test('native direct outcomes use generic history without exposing paths or URLs', async () => {
  const { context } = await worker({ nativeHandler: (_payload, callback) => callback({ ok: true, filename: 'clip.mp4', bytes: 123, output_dir: '/private/output' }) });
  await context.queueSmartDownload({ kind: 'native', payload: { command: 'download_direct', url: 'https://cdn.test/clip.mp4?token=secret' } });
  await new Promise(setImmediate);
  const history = (await context.repairDownloadHistoryAssociations()).downloadHistory;
  assert.equal(history.length, 1);
  assert.equal(history[0].source, 'generic');
  assert.ok(!JSON.stringify(history).includes('/private'));
  assert.ok(!JSON.stringify(history).includes('token'));
});

test('repeated history repair retains the newest bounded outcomes', async () => {
  const { context } = await worker({ completeImmediately: true });
  await context.downloadMedia({ items: Array.from({ length: 25 }, (_, i) => ({ url: `https://cdn.test/${i}.jpg`, type: 'image' })) });
  const first = (await context.repairDownloadHistoryAssociations()).downloadHistory.map((r) => r.id);
  const second = (await context.repairDownloadHistoryAssociations()).downloadHistory.map((r) => r.id);
  assert.equal(first.length, 20);
  assert.deepEqual(second, first);
});
