const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

export function normalizeReviewText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTokens(value) {
  return new Set(
    normalizeReviewText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function entryRef(entry) {
  return {
    uid: Number(entry.uid),
    name: entry.comment || `Entry #${entry.uid}`,
  };
}

function issueKey(issue) {
  const uids = (issue.entries || [])
    .map((entry) => Number(entry.uid))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .join(",");
  return `${issue.type || "other"}::${uids}`;
}

export function dedupeReviewIssues(issues) {
  const byKey = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue || typeof issue !== "object") continue;
    const key = issueKey(issue);
    if (!byKey.has(key)) byKey.set(key, issue);
  }
  return [...byKey.values()];
}

function addGroupedIssue(issues, type, severity, description, entries) {
  if (entries.length < 2) return;
  issues.push({
    type,
    severity,
    description,
    entries: entries.map(entryRef),
    source: "local-preflight",
  });
}

function addGroups(issues, entries, selector, type, severity, description) {
  const groups = new Map();
  for (const entry of entries) {
    const value = selector(entry);
    if (!value) continue;
    const group = groups.get(value) || [];
    group.push(entry);
    groups.set(value, group);
  }
  for (const [value, group] of groups) {
    if (group.length >= 2) {
      addGroupedIssue(
        issues,
        type,
        severity,
        description(value, group),
        group,
      );
    }
  }
}

export function findLocalReviewIssues(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const issues = [];
  const verboseChars = Number.isFinite(options.verboseChars)
    ? Math.max(1000, options.verboseChars)
    : 20000;

  addGroups(
    issues,
    list,
    (entry) => normalizeReviewText(entry.comment),
    "duplicate",
    "medium",
    (value) => `Entries share the same normalized title: "${value}".`,
  );
  addGroups(
    issues,
    list,
    (entry) => {
      const value = normalizeReviewText(entry.content);
      return value.length >= 24 ? value : "";
    },
    "duplicate",
    "high",
    () => "Entries have identical normalized content.",
  );

  const keyGroups = new Map();
  for (const entry of list) {
    for (const rawKey of [...(entry.key || []), ...(entry.keysecondary || [])]) {
      const key = normalizeReviewText(rawKey);
      if (!key || key.length < 4 || STOP_WORDS.has(key)) continue;
      const group = keyGroups.get(key) || [];
      if (!group.some((candidate) => candidate.uid === entry.uid)) group.push(entry);
      keyGroups.set(key, group);
    }
  }
  for (const [key, group] of keyGroups) {
    addGroupedIssue(
      issues,
      "overlap",
      "low",
      `The activation key "${key}" is shared by multiple entries and may cause overlapping matches.`,
      group,
    );
  }

  for (const entry of list) {
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) {
      issues.push({
        type: "other",
        severity: "medium",
        description: "This entry has no content.",
        entries: [entryRef(entry)],
        source: "local-preflight",
      });
    } else if (content.length > verboseChars) {
      issues.push({
        type: "verbose",
        severity: "low",
        description: `This entry contains ${content.length} characters, above the local verbosity threshold of ${verboseChars}.`,
        entries: [entryRef(entry)],
        source: "local-preflight",
      });
    }
  }

  return dedupeReviewIssues(issues);
}

function sharedKeys(left, right) {
  const leftKeys = new Set(
    [...(left.key || []), ...(left.keysecondary || [])]
      .map(normalizeReviewText)
      .filter((key) => key.length >= 4 && !STOP_WORDS.has(key)),
  );
  return [...new Set(
    [...(right.key || []), ...(right.keysecondary || [])]
      .map(normalizeReviewText)
      .filter((key) => leftKeys.has(key)),
  )];
}

export function buildCrossBatchCandidates(entries, batches, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const batchByUid = new Map();
  (Array.isArray(batches) ? batches : []).forEach((batch, index) => {
    for (const entry of Array.isArray(batch) ? batch : []) {
      batchByUid.set(Number(entry.uid), index);
    }
  });
  const maxCandidates = Number.isFinite(options.maxCandidates)
    ? Math.max(1, Math.floor(options.maxCandidates))
    : 24;
  const candidates = [];

  for (let leftIndex = 0; leftIndex < list.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex++) {
      const left = list[leftIndex];
      const right = list[rightIndex];
      const leftBatch = batchByUid.get(Number(left.uid));
      const rightBatch = batchByUid.get(Number(right.uid));
      if (leftBatch === undefined || rightBatch === undefined || leftBatch === rightBatch) continue;

      const reasons = [];
      const keys = sharedKeys(left, right);
      if (keys.length) reasons.push(`shared keys: ${keys.join(", ")}`);
      const leftTitle = normalizeReviewText(left.comment);
      const rightTitle = normalizeReviewText(right.comment);
      if (leftTitle && leftTitle === rightTitle) reasons.push("same normalized title");
      const leftTokens = meaningfulTokens(left.comment);
      const rightTokens = meaningfulTokens(right.comment);
      const overlap = [...leftTokens].filter((token) => rightTokens.has(token));
      if (overlap.length >= 2) reasons.push(`shared title terms: ${overlap.join(", ")}`);
      if (!reasons.length) continue;

      candidates.push({
        left: entryRef(left),
        right: entryRef(right),
        leftEntry: left,
        rightEntry: right,
        reason: reasons.join("; "),
      });
      if (candidates.length >= maxCandidates) return candidates;
    }
  }
  return candidates;
}

export function formatCrossBatchCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(({ leftEntry, rightEntry, reason }) => {
      const format = (entry) => {
        const keys = [...(entry.key || []), ...(entry.keysecondary || [])].join(", ") || "(none)";
        return `--- Entry uid=${entry.uid} | name="${entry.comment || `Entry #${entry.uid}`}" | keys=[${keys}] ---\n${entry.content || ""}`;
      };
      return `## Candidate pair (${reason})\n${format(leftEntry)}\n\n${format(rightEntry)}`;
    })
    .join("\n\n");
}
