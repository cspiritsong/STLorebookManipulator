// Shared HTML escaping utilities.
//
// These were previously duplicated across index.js, ui.js, and diff.js,
// which caused a bug where escapeAttr was used in ui.js but only defined
// in index.js (ReferenceError at runtime). Centralizing them here ensures
// every module uses the same, tested implementation.

// Escape text for safe insertion into HTML element content.
// Uses a pure string implementation (no DOM dependency) so it works
// in both the browser and Node test environments.
export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escape text for safe insertion into an HTML attribute value.
// Only quotes need escaping in attribute contexts.
export function escapeAttr(text) {
    return String(text ?? '')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
