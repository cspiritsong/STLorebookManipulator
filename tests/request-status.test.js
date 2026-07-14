import {
  createRequestOptions,
  showRequestProgress,
  waitForRequestContinue,
} from "../src/request-status.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeStatusElement() {
  return {
    className: "",
    innerHTML: "",
    style: {},
    querySelector() {
      return null;
    },
  };
}

console.log("\n=== Request Status Tests ===\n");

const waitingStatus = makeStatusElement();
showRequestProgress(waitingStatus, "Reviewing lorebook", {
  state: "waiting",
  remainingMs: 2500,
  intervalMs: 5000,
});
assert(
  waitingStatus.className === "lm-status lm-status-loading" &&
    waitingStatus.innerHTML.includes("waiting 2.5s") &&
    waitingStatus.innerHTML.includes("5s request delay") &&
    waitingStatus.innerHTML.includes('aria-valuenow="38"'),
  "Waiting progress reflects the configured delay",
);

const optionsStatus = makeStatusElement();
const options = createRequestOptions(optionsStatus, "Generating suggestion", 7000);
assert(
  options.requestDelayMs === 7000 &&
    typeof options.onProgress === "function" &&
    typeof options.onRequestFailure === "function",
  "Request options preserve the selected delay and callbacks",
);

const cancelled = new AbortController();
cancelled.abort();
assert(
  (await waitForRequestContinue(
    makeStatusElement(),
    "Reviewing lorebook",
    new Error("503"),
    cancelled.signal,
  )) === false,
  "Aborted workflows do not wait for Continue",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
