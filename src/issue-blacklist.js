const STORAGE_PREFIX = "lorebook_manipulator_ignored_issues_";

// An issue's description is model-generated and can vary between reviews.
// Its type plus affected entry UIDs is stable enough to let users suppress an
// accepted warning without hiding unrelated issues.
export function getIssueFingerprint(bookName, issue) {
  const uids = (issue?.entries || [])
    .map((entry) => Number(entry?.uid))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .join(",");
  return `${bookName}::${issue?.type || "other"}::${uids}`;
}

export function getIgnoredIssueKeys(bookName) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + bookName);
    const keys = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [],
    );
  } catch (e) {
    console.warn("[LorebookManipulator] Could not load ignored issues:", e);
    return new Set();
  }
}

export function ignoreIssue(bookName, issue) {
  const keys = getIgnoredIssueKeys(bookName);
  keys.add(getIssueFingerprint(bookName, issue));
  localStorage.setItem(STORAGE_PREFIX + bookName, JSON.stringify([...keys]));
  return keys;
}

export function filterIgnoredIssues(bookName, issues) {
  const keys = getIgnoredIssueKeys(bookName);
  return (Array.isArray(issues) ? issues : []).filter(
    (issue) => !keys.has(getIssueFingerprint(bookName, issue)),
  );
}

export function clearIgnoredIssues(bookName) {
  localStorage.removeItem(STORAGE_PREFIX + bookName);
}
