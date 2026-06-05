// Translates raw/technical errors into newbie-friendly guidance.
//
// Each rule matches a substring (case-insensitive) in the error message and
// returns { title, what, fix } — a short label, a plain explanation of what
// went wrong, and a concrete step to fix it. The first matching rule wins,
// so order matters: put more specific patterns before general ones.
//
// This is a pure function (no I/O) so it is easy to unit-test.

const RULES = [
  {
    match: [
      "could not parse",
      "invalid json",
      "not valid json",
      "unexpected token",
      "invalid xml",
      "no results from ai",
      "json",
      "xml",
    ],
    title: "The AI did not reply in the right format",
    what: "The extension asked the AI for a structured (JSON) answer, but the reply could not be read. This usually means the model is too small, or its response was cut off before it finished.",
    fix: 'Try a capable model (OpenAI, Claude, or Gemini work well), and raise "Max Response Tokens" in settings to 2000 or more. If you picked a Connection Profile, make sure it uses a plain preset, not a roleplay one.',
  },
  {
    match: ["connection manager is not available", "connection manager"],
    title: "Connection Manager is turned off",
    what: "You chose a specific Connection Profile, but SillyTavern's Connection Manager extension is not enabled, so the request could not be sent.",
    fix: 'Either enable the built-in "Connection Manager" extension, or set Connection Profile back to "Active connection (default)" in settings.',
  },
  {
    match: ["profile not found", "profile with id", "could not find profile"],
    title: "The chosen connection profile is missing",
    what: "The Connection Profile this extension was set to use no longer exists (it may have been renamed or deleted).",
    fix: 'Open settings and pick a Connection Profile again, or choose "Active connection (default)".',
  },
  {
    match: [
      "no connection",
      "no api",
      "api is not connected",
      "select a connection profile that has an api",
      "onlinestatus",
      "no_connection",
    ],
    title: "No AI connection is active",
    what: "SillyTavern is not currently connected to an AI model, so the extension has nothing to send the request to.",
    fix: "Open the API Connections panel (the plug icon) and connect to your model. Once the status shows connected, try again.",
  },
  {
    match: ["quota", "rate limit", "rate-limit", "429", "too many requests"],
    title: "The AI provider is rate-limiting or out of quota",
    what: "Your API provider rejected the request because you have sent too many requests recently, or your account is out of credit.",
    fix: "Wait a minute and try again. If it keeps happening, check your provider account for remaining credit or usage limits. Reviewing a large book makes several requests — try a smaller book or fewer entries.",
  },
  {
    match: [
      "401",
      "403",
      "unauthorized",
      "forbidden",
      "api key",
      "invalid key",
      "authentication",
    ],
    title: "The API key was rejected",
    what: "The AI provider refused the request because the API key is missing, wrong, or not allowed to use this model.",
    fix: "Re-check your API key in SillyTavern's API Connections panel. Make sure it is valid and has access to the selected model.",
  },
  {
    match: [
      "context length",
      "context window",
      "too long",
      "maximum context",
      "token limit exceeded",
    ],
    title: "The request was too big for the model",
    what: "The lorebook text sent to the AI was larger than the model's context window.",
    fix: "Use a model with a larger context window, or review a smaller lorebook. The extension already splits large books into batches, but a single huge entry can still be too big.",
  },
  {
    match: [
      "timeout",
      "timed out",
      "etimedout",
      "network",
      "fetch failed",
      "failed to fetch",
      "econnrefused",
    ],
    title: "Could not reach the AI",
    what: "The request to the AI failed to complete — usually a network problem, or the server (for local models) is not running.",
    fix: "Check your internet connection. If you use a local model, make sure its server is running and reachable. Then try again.",
  },
  {
    match: ["no entries", "there are no entries"],
    title: "This lorebook has no entries to work with",
    what: "The selected lorebook is empty, so there is nothing to review or edit.",
    fix: "Pick a lorebook that has entries, or add some entries in SillyTavern's World Info editor first.",
  },
  {
    match: ["storage", "quota exceeded", "localstorage"],
    title: "Backup storage is full",
    what: "The browser ran out of space to save a backup, so the change was not applied (to keep your data safe).",
    fix: 'Lower "Backups to Keep" in settings, or clear old backups. Then try again.',
  },
  {
    match: ["not found", "uid"],
    title: "That entry could not be found",
    what: "The entry may have been changed or removed in SillyTavern since the list was loaded.",
    fix: "Close and reopen the Lorebook Manipulator to reload the latest entries, then try again.",
  },
];

// Returns a friendly explanation for an error or message string.
// Always returns an object: { title, what, fix }.
export function explainError(error) {
  const message = (
    error && error.message ? error.message : String(error || "")
  ).toLowerCase();

  for (const rule of RULES) {
    if (rule.match.some((needle) => message.includes(needle))) {
      return { title: rule.title, what: rule.what, fix: rule.fix };
    }
  }

  // Fallback for anything we don't have a specific rule for.
  return {
    title: "Something went wrong",
    what: "The extension hit an unexpected problem.",
    fix: "Try again. If it keeps failing, open the browser console (F12) for the technical details, or report it on the project's GitHub issues page.",
    raw: error && error.message ? error.message : String(error || ""),
  };
}

// Render a friendly explanation as HTML for display in a popup/status area.
// `escapeHtml` is injected so this module stays free of DOM dependencies.
export function renderFriendlyError(error, escapeHtml) {
  const info = explainError(error);
  const rawLine = info.raw
    ? `<div class="lm-error-raw">Technical detail: ${escapeHtml(info.raw)}</div>`
    : "";
  return `<div class="lm-friendly-error">
        <div class="lm-error-title"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(info.title)}</div>
        <div class="lm-error-what">${escapeHtml(info.what)}</div>
        <div class="lm-error-fix"><strong>How to fix:</strong> ${escapeHtml(info.fix)}</div>
        ${rawLine}
    </div>`;
}
