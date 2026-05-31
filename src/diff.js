export function computeDiff(oldText, newText) {
    const oldWords = tokenize(oldText);
    const newWords = tokenize(newText);

    const lcs = buildLCS(oldWords, newWords);

    const result = [];
    let oi = 0;
    let ni = 0;
    let li = 0;

    while (oi < oldWords.length || ni < newWords.length) {
        if (li < lcs.length && oi < oldWords.length && oldWords[oi] === lcs[li] && ni < newWords.length && newWords[ni] === lcs[li]) {
            result.push({ type: 'equal', value: oldWords[oi] });
            oi++;
            ni++;
            li++;
        } else if (li < lcs.length && ni < newWords.length && newWords[ni] === lcs[li]) {
            result.push({ type: 'delete', value: oldWords[oi] });
            oi++;
        } else if (li < lcs.length && oi < oldWords.length && oldWords[oi] === lcs[li]) {
            result.push({ type: 'insert', value: newWords[ni] });
            ni++;
        } else {
            if (oi < oldWords.length && (ni >= newWords.length || li >= lcs.length)) {
                result.push({ type: 'delete', value: oldWords[oi] });
                oi++;
            } else if (ni < newWords.length) {
                result.push({ type: 'insert', value: newWords[ni] });
                ni++;
            }
        }
    }

    return mergeAdjacent(result);
}

function tokenize(text) {
    if (!text) return [];
    return text.match(/\S+|\s+/g) || [];
}

function buildLCS(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const result = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            result.unshift(a[i - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return result;
}

function mergeAdjacent(diffResult) {
    if (diffResult.length === 0) return [];

    const merged = [diffResult[0]];
    for (let i = 1; i < diffResult.length; i++) {
        const last = merged[merged.length - 1];
        if (last.type === diffResult[i].type) {
            last.value += diffResult[i].value;
        } else {
            merged.push(diffResult[i]);
        }
    }

    return merged;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function renderInlineDiff(diffResult) {
    let html = '<div class="lm-diff lm-diff-inline">';

    for (const part of diffResult) {
        const escaped = escapeHtml(part.value);
        switch (part.type) {
            case 'equal':
                html += `<span class="lm-diff-equal">${escaped}</span>`;
                break;
            case 'delete':
                html += `<del class="lm-diff-delete">${escaped}</del>`;
                break;
            case 'insert':
                html += `<ins class="lm-diff-insert">${escaped}</ins>`;
                break;
        }
    }

    html += '</div>';
    return html;
}

export function renderSideBySideDiff(diffResult) {
    let leftHtml = '';
    let rightHtml = '';

    for (const part of diffResult) {
        const escaped = escapeHtml(part.value);
        switch (part.type) {
            case 'equal':
                leftHtml += `<span class="lm-diff-equal">${escaped}</span>`;
                rightHtml += `<span class="lm-diff-equal">${escaped}</span>`;
                break;
            case 'delete':
                leftHtml += `<del class="lm-diff-delete">${escaped}</del>`;
                rightHtml += `<span class="lm-diff-placeholder">${escaped.replace(/\S/g, '&nbsp;')}</span>`;
                break;
            case 'insert':
                leftHtml += `<span class="lm-diff-placeholder">${escaped.replace(/\S/g, '&nbsp;')}</span>`;
                rightHtml += `<ins class="lm-diff-insert">${escaped}</ins>`;
                break;
        }
    }

    return `<div class="lm-diff lm-diff-side-by-side">
        <div class="lm-diff-col lm-diff-original"><div class="lm-diff-label">Original</div><div class="lm-diff-content">${leftHtml}</div></div>
        <div class="lm-diff-col lm-diff-suggestion"><div class="lm-diff-label">Suggestion</div><div class="lm-diff-content">${rightHtml}</div></div>
    </div>`;
}
