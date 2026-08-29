// Pure state model for the browser UI.
//
// The popup handlers still own DOM rendering and SillyTavern calls, but their
// asynchronous results must pass through this model before they become visible.
// A monotonically increasing operation token prevents a late load, review, or
// mutation from repainting a newer book/view after a selection change or cancel.

const VALID_VIEWS = new Set(["main", "editor", "resolve", "create"]);

function copyEntries(entries) {
  return Array.isArray(entries) ? [...entries] : [];
}

function copyFixedIssues(issues) {
  if (issues instanceof Set) return new Set(issues);
  return new Set(Array.isArray(issues) ? issues : []);
}

function normalizeView(view) {
  return VALID_VIEWS.has(view) ? view : "main";
}

function normalizeBookName(bookName) {
  return typeof bookName === "string" && bookName.trim() ? bookName : null;
}

export function createUIState(initial = {}) {
  const selectedBook = normalizeBookName(initial.selectedBook);
  const entriesByBook =
    initial.entriesByBook instanceof Map
      ? new Map(initial.entriesByBook)
      : new Map();

  if (selectedBook && Array.isArray(initial.entries)) {
    entriesByBook.set(selectedBook, copyEntries(initial.entries));
  }

  return {
    selectedBook,
    selectedBooks: Array.isArray(initial.selectedBooks)
      ? [...new Set(initial.selectedBooks.filter((name) => typeof name === "string"))]
      : selectedBook
        ? [selectedBook]
        : [],
    entries: copyEntries(initial.entries),
    entriesByBook,
    searchText: typeof initial.searchText === "string" ? initial.searchText : "",
    review: initial.review || null,
    fixedIssues: copyFixedIssues(initial.fixedIssues),
    activeView: normalizeView(initial.activeView),
    pendingOperation: null,
    operationVersion:
      Number.isInteger(initial.operationVersion) && initial.operationVersion >= 0
        ? initial.operationVersion
        : 0,
  };
}

function nextOperationVersion(state) {
  return state.operationVersion + 1;
}

export function reduceUIState(state, action = {}) {
  const current = state || createUIState();

  switch (action.type) {
    case "book-selected": {
      const selectedBook = normalizeBookName(action.bookName);
      return {
        ...current,
        selectedBook,
        selectedBooks: selectedBook ? [selectedBook] : [],
        entries: [],
        review: null,
        fixedIssues: new Set(),
        searchText: "",
        activeView: "main",
        pendingOperation: null,
        operationVersion: nextOperationVersion(current),
      };
    }

    case "search-changed":
      return {
        ...current,
        searchText: typeof action.searchText === "string" ? action.searchText : "",
      };

    case "view-opened":
      return { ...current, activeView: normalizeView(action.view) };

    case "view-closed":
      return { ...current, activeView: "main" };

    case "operation-started":
      return {
        ...current,
        pendingOperation: Object.freeze({
          id: action.id,
          kind: action.kind,
          bookName: normalizeBookName(action.bookName) || current.selectedBook,
        }),
        operationVersion: action.id,
      };

    case "operation-completed": {
      if (!isCurrentUIOperation(current, action.token)) return current;

      const next = {
        ...current,
        pendingOperation: null,
      };
      if (Array.isArray(action.entries)) {
        next.entries = copyEntries(action.entries);
        const bookName = normalizeBookName(action.bookName) || current.selectedBook;
        if (bookName) {
          next.entriesByBook = new Map(current.entriesByBook);
          next.entriesByBook.set(bookName, copyEntries(action.entries));
        }
      }
      if (Object.hasOwn(action, "review")) next.review = action.review;
      if (action.fixedIssues !== undefined) {
        next.fixedIssues = copyFixedIssues(action.fixedIssues);
      }
      return next;
    }

    case "operation-failed":
      return isCurrentUIOperation(current, action.token)
        ? { ...current, pendingOperation: null }
        : current;

    case "operation-cancelled":
      return isCurrentUIOperation(current, action.token)
        ? {
            ...current,
            pendingOperation: null,
            operationVersion: nextOperationVersion(current),
          }
        : current;

    case "issues-fixed": {
      const nextFixed = copyFixedIssues(current.fixedIssues);
      for (const issue of action.issues || []) nextFixed.add(issue);
      return { ...current, fixedIssues: nextFixed };
    }

    case "review-cleared":
      return { ...current, review: null, fixedIssues: new Set() };

    default:
      return current;
  }
}

export function selectBook(state, bookName) {
  return reduceUIState(state, { type: "book-selected", bookName });
}

export function beginUIOperation(state, kind, metadata = {}) {
  const current = state || createUIState();
  const id = nextOperationVersion(current);
  const token = Object.freeze({
    id,
    kind: String(kind || "operation"),
    bookName: normalizeBookName(metadata.bookName) || current.selectedBook,
  });
  return {
    state: reduceUIState(current, {
      type: "operation-started",
      id,
      kind: token.kind,
      bookName: token.bookName,
    }),
    token,
  };
}

export function isCurrentUIOperation(state, token) {
  const pending = state?.pendingOperation;
  return Boolean(
    token &&
      pending &&
      pending.id === token.id &&
      pending.kind === token.kind &&
      pending.bookName === token.bookName &&
      state.operationVersion === token.id &&
      (token.bookName === null || state.selectedBook === token.bookName),
  );
}

export function completeUIOperation(state, token, result = {}) {
  return reduceUIState(state, {
    type: "operation-completed",
    token,
    ...result,
  });
}

export function failUIOperation(state, token) {
  return reduceUIState(state, { type: "operation-failed", token });
}

export function cancelUIOperation(state, token) {
  return reduceUIState(state, { type: "operation-cancelled", token });
}
