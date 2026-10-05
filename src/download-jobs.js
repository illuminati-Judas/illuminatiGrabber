(function (root) {
  'use strict';

  function iso(now) {
    return now || new Date().toISOString();
  }

  function createDownloadJob({ id, item, filename, now }) {
    const timestamp = iso(now);
    return {
      id,
      source: 'generic',
      status: 'waiting',
      type: item.type,
      filename,
      downloadIndex: item.downloadIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      attempt: 0,
      downloadId: null,
      bytesReceived: 0,
      totalBytes: Number(item.bytes) > 0 ? Number(item.bytes) : null,
      progressPercent: null,
      errorCode: null,
      errorMessage: null,
      request: { url: item.url },
      launch: null,
    };
  }

  function startWaitingJob(job, now) {
    if (!job || job.status !== 'waiting') return null;
    const timestamp = iso(now);
    return {
      ...job,
      status: 'downloading',
      attempt: (job.attempt || 0) + 1,
      startedAt: timestamp,
      completedAt: null,
      updatedAt: timestamp,
      downloadId: null,
      bytesReceived: 0,
      progressPercent: null,
      errorCode: null,
      errorMessage: null,
      launch: { requestedAt: timestamp },
    };
  }

  function applyDownloadDelta(job, delta, now) {
    if (!job || job.status !== 'downloading' || job.downloadId !== delta.id) return job;
    const bytesReceived = Math.max(0, Number(delta.bytesReceived?.current ?? job.bytesReceived) || 0);
    const reportedTotal = Number(delta.totalBytes?.current ?? job.totalBytes);
    const totalBytes = reportedTotal > 0 ? reportedTotal : null;
    const progressPercent = totalBytes > 0 ? Math.min(100, Math.floor(bytesReceived * 100 / totalBytes)) : null;
    const next = { ...job, bytesReceived, totalBytes, progressPercent, updatedAt: iso(now) };
    if (delta.state?.current === 'complete') {
      next.status = 'completed';
      next.completedAt = next.updatedAt;
      next.progressPercent = 100;
      next.request = undefined;
      next.launch = null;
      next.errorCode = null;
      next.errorMessage = null;
    } else if (delta.state?.current === 'interrupted') {
      next.status = 'failed';
      next.completedAt = next.updatedAt;
      next.launch = null;
      next.errorCode = String(delta.error?.current || 'DOWNLOAD_INTERRUPTED');
      next.errorMessage = needsFreshScan(next)
        ? 'URL expired or access denied. Scan the page again for a fresh media URL.' : next.errorCode;
    }
    return next;
  }

  function retryFailedJob(job, now) {
    if (!job || job.status !== 'failed' || !job.request?.url || needsFreshScan(job)) return null;
    return {
      ...job,
      status: 'waiting',
      updatedAt: iso(now),
      startedAt: null,
      completedAt: null,
      downloadId: null,
      bytesReceived: 0,
      progressPercent: null,
      errorCode: null,
      errorMessage: null,
      launch: null,
    };
  }

  function cancelWaitingJob(jobs, id) {
    const job = jobs.find((entry) => entry.id === id);
    if (!job || job.status !== 'waiting') return { ok: false, jobs };
    return { ok: true, jobs: jobs.filter((entry) => entry.id !== id) };
  }

  function publicJob(job) {
    const { request, launch, ...safe } = job;
    return { ...safe, needsFreshScan: needsFreshScan(job) };
  }

  function needsFreshScan(job) {
    return ['SERVER_FORBIDDEN', 'SERVER_UNAUTHORIZED', 'SERVER_BAD_CONTENT', 'SERVER_FILE_NOT_FOUND'].includes(job?.errorCode);
  }

  const api = { createDownloadJob, startWaitingJob, applyDownloadDelta, retryFailedJob, cancelWaitingJob, publicJob, needsFreshScan };
  root.WebMediaDownloadJobs = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
