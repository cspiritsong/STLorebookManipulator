import { renderFriendlyError } from "./errors.js";
import { escapeHtml } from "./utils.js";

// Render queue progress consistently for every AI workflow, so deliberate
// pacing is visibly different from a request that has stalled.
export function createRequestProgressReporter(el, label) {
  return (progress) => showRequestProgress(el, label, progress);
}

// Single-request tools use these callbacks directly. Review workflows use the
// exported progress and Continue helpers under their review-specific names.
export function createRequestOptions(el, label, requestDelayMs = 5000) {
  return {
    requestDelayMs,
    onProgress: createRequestProgressReporter(el, label),
    onRequestFailure: (error) => waitForRequestContinue(el, label, error),
  };
}

export function showRequestProgress(el, label, progress) {
  if (!el) return;
  let message = `${label}: queued (position ${progress.position || 1}).`;
  let percent = 5;

  if (progress.state === "waiting") {
    const seconds = (progress.remainingMs / 1000).toFixed(1);
    const intervalMs = progress.intervalMs || 5000;
    message = `${label}: waiting ${seconds}s to respect the ${intervalMs / 1000}s request delay.`;
    percent = Math.max(
      10,
      Math.min(75, 75 * (1 - progress.remainingMs / intervalMs)),
    );
  } else if (progress.state === "running") {
    message = `${label}: request in progress...`;
    percent = 85;
  } else if (progress.state === "complete") {
    message = `${label}: request complete.`;
    percent = 100;
  }

  el.className = "lm-status lm-status-loading";
  el.innerHTML = `<div>${escapeHtml(message)}</div><div class="lm-request-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><div class="lm-request-progress-fill" style="width:${percent}%"></div></div>`;
  el.style.display = "block";
}

// A provider failure pauses only the failed LLM request. Continue reruns that
// request through the queue; completed review batches and applied changes stay
// intact. Write failures are still handled by their existing backup-safe paths.
export function waitForRequestContinue(el, label, error, signal = null) {
  return new Promise((resolve) => {
    if (!el || signal?.aborted) {
      resolve(false);
      return;
    }

    el.className = "lm-status lm-status-error";
    el.innerHTML = `${renderFriendlyError(error, escapeHtml)}<button type="button" class="menu_button lm-request-continue">Continue ${escapeHtml(label)}</button>`;
    el.style.display = "block";

    const continueButton = el.querySelector(".lm-request-continue");
    const finish = (value) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    continueButton?.addEventListener("click", () => finish(true), { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
