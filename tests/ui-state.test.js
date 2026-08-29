import {
  beginUIOperation,
  cancelUIOperation,
  completeUIOperation,
  createUIState,
  isCurrentUIOperation,
  reduceUIState,
  selectBook,
} from "../src/ui-state.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

console.log("\n=== UI State Transition Tests ===\n");

const initial = createUIState({
  selectedBook: "Old Book",
  entries: [{ uid: 1, content: "old" }],
  review: { issues: [{ type: "old" }] },
  fixedIssues: [{ type: "fixed" }],
  activeView: "editor",
});

assert(initial.selectedBook === "Old Book", "Initial selected book is preserved");
assert(initial.entries.length === 1, "Initial entries are preserved");
assert(initial.fixedIssues.size === 1, "Initial fixed issues are copied into a Set");

const selected = selectBook(initial, "New Book");
assert(selected.selectedBook === "New Book", "Selecting a book updates the selected book");
assert(selected.entries.length === 0, "Selecting a book clears entries owned by the old book");
assert(selected.review === null, "Selecting a book clears the old review");
assert(selected.fixedIssues.size === 0, "Selecting a book clears fixed issue state");
assert(selected.activeView === "main", "Selecting a book returns to the main view");
assert(selected.pendingOperation === null, "Selecting a book clears pending operation state");

const loadStarted = beginUIOperation(selected, "load", { bookName: "New Book" });
assert(loadStarted.token.id > 0, "Starting an operation returns a monotonic token");
assert(isCurrentUIOperation(loadStarted.state, loadStarted.token), "New operation is current");
assert(loadStarted.state.pendingOperation.kind === "load", "Pending operation records its kind");

const switched = selectBook(loadStarted.state, "Another Book");
const staleLoad = completeUIOperation(switched, loadStarted.token, {
  entries: [{ uid: 2, content: "stale" }],
  bookName: "New Book",
});
assert(!isCurrentUIOperation(switched, loadStarted.token), "Switching books invalidates the old operation token");
assert(staleLoad.selectedBook === "Another Book", "Completing an old operation does not rewrite current selection");
assert(staleLoad.entries.length === 0, "A stale load cannot replace the current book's entries");

const currentLoad = beginUIOperation(switched, "load", { bookName: "Another Book" });
const loaded = completeUIOperation(currentLoad.state, currentLoad.token, {
  bookName: "Another Book",
  entries: [{ uid: 3, content: "fresh" }],
});
assert(loaded.entries[0].content === "fresh", "Current load result becomes visible");
assert(loaded.entriesByBook.get("Another Book")[0].uid === 3, "Current load is cached under its owning book");
assert(loaded.pendingOperation === null, "Completed load clears pending operation state");

const reviewStarted = beginUIOperation(loaded, "review", { bookName: "Another Book" });
const reviewed = completeUIOperation(reviewStarted.state, reviewStarted.token, {
  review: { issues: [{ type: "duplicate" }], batchCount: 1 },
});
assert(reviewed.review.issues[0].type === "duplicate", "Current review result becomes visible");
assert(reviewed.pendingOperation === null, "Completed review clears pending operation state");

const cancelledStart = beginUIOperation(reviewed, "review", { bookName: "Another Book" });
const cancelled = cancelUIOperation(cancelledStart.state, cancelledStart.token);
assert(cancelled.pendingOperation === null, "Cancelling clears pending operation state");
assert(!isCurrentUIOperation(cancelled, cancelledStart.token), "Cancelled operation can no longer publish a late result");
const lateReview = completeUIOperation(cancelled, cancelledStart.token, {
  review: { issues: [{ type: "late" }] },
});
assert(lateReview.review.issues[0].type === "duplicate", "Late cancelled review cannot replace the visible review");

const withView = reduceUIState(reviewed, { type: "view-opened", view: "resolve" });
assert(withView.activeView === "resolve", "Opening a view records the active view");
const withSearch = reduceUIState(withView, { type: "search-changed", searchText: "dragon" });
assert(withSearch.searchText === "dragon", "Search text is represented as state");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
