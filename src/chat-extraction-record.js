const STORAGE_KEY = "lorebook_manipulator_chat_extraction_records";

function getRecordKey(chatId, bookName) {
  return `${chatId}::${bookName}`;
}

function readRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return records && typeof records === "object" && !Array.isArray(records)
      ? records
      : {};
  } catch (e) {
    console.warn("[LorebookManipulator] Could not load chat extraction records:", e);
    return {};
  }
}

// Return the highest message index successfully added to this lorebook from
// this exact chat. The chat ID keeps separate conversations from overwriting
// each other's resume point.
export function getChatExtractionRecord(chatId, bookName) {
  if (!chatId || !bookName) return null;
  const value = readRecords()[getRecordKey(chatId, bookName)];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// Never move the resume point backward: users may deliberately extract an
// older or overlapping range, but their next suggested range stays ahead of
// the furthest message that was successfully added.
export function recordChatExtraction(chatId, bookName, endMessageIndex) {
  if (!chatId || !bookName || !Number.isInteger(endMessageIndex) || endMessageIndex < 0) {
    return null;
  }

  const records = readRecords();
  const key = getRecordKey(chatId, bookName);
  const previous = records[key];
  const savedIndex = Number.isInteger(previous)
    ? Math.max(previous, endMessageIndex)
    : endMessageIndex;

  try {
    records[key] = savedIndex;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return savedIndex;
  } catch (e) {
    console.warn("[LorebookManipulator] Could not save chat extraction record:", e);
    return null;
  }
}
