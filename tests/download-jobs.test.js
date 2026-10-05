const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDownloadJob,
  startWaitingJob,
  applyDownloadDelta,
  retryFailedJob,
  cancelWaitingJob,
  publicJob,
} = require('../src/download-jobs.js');

const item = { url: 'https://cdn.test/photo.jpg', type: 'image', downloadIndex: 3 };
const { buildDownloadPath } = require('../src/downloads.js');
const createWaitingJob = () => createDownloadJob({
  id: 'job-1',
  item,
  filename: buildDownloadPath('WebMedia', item.url, item.type, item.downloadIndex),
  now: '2026-01-01T00:00:00.000Z',
});

test('creates a private waiting job and strips retry URL from public state', () => {
  const job = createWaitingJob();
  assert.equal(job.status, 'waiting');
  assert.equal(job.request.url, item.url);
  assert.equal(job.filename, 'WebMedia/cdn.test/images/photo.jpg');
  assert.equal(publicJob(job).request, undefined);
  assert.equal(publicJob(job).launch, undefined);
});

test('moves a waiting job through downloading progress to completed', () => {
  const waiting = createWaitingJob();
  const downloading = startWaitingJob(waiting, '2026-01-01T00:00:01.000Z');
  assert.equal(downloading.status, 'downloading');
  assert.equal(downloading.attempt, 1);
  downloading.downloadId = 42;
  const progress = applyDownloadDelta(downloading, { id: 42, bytesReceived: { current: 50 }, totalBytes: { current: 100 } }, '2026-01-01T00:00:02.000Z');
  assert.equal(progress.progressPercent, 50);
  const completed = applyDownloadDelta(progress, { id: 42, state: { current: 'complete' } }, '2026-01-01T00:00:03.000Z');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progressPercent, 100);
  assert.equal(completed.request, undefined);
});

test('failed jobs retain a private retry request and can return to waiting', () => {
  const waiting = createWaitingJob();
  const downloading = { ...startWaitingJob(waiting, '2026-01-01T00:00:01.000Z'), downloadId: 42 };
  const failed = applyDownloadDelta(downloading, { id: 42, state: { current: 'interrupted' }, error: { current: 'NETWORK_FAILED' } }, '2026-01-01T00:00:02.000Z');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.request.url, item.url);
  const retried = retryFailedJob(failed, '2026-01-01T00:00:03.000Z');
  assert.equal(retried.status, 'waiting');
  assert.equal(retried.downloadId, null);
  assert.equal(retried.errorCode, null);
});

test('cancels only waiting jobs', () => {
  const waiting = createWaitingJob();
  assert.deepEqual(cancelWaitingJob([waiting], 'job-1'), { ok: true, jobs: [] });
  const downloading = startWaitingJob(waiting, '2026-01-01T00:00:01.000Z');
  assert.deepEqual(cancelWaitingJob([downloading], 'job-1'), { ok: false, jobs: [downloading] });
});
