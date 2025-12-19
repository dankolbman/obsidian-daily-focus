/**
 * Date utilities for parsing and formatting dates.
 */

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a Date object.
 * Returns null if the string doesn't match the expected format.
 */
export function parseDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  // Validate the date is valid (handles cases like 2024-02-30)
  if (
    date.getFullYear() !== parseInt(year) ||
    date.getMonth() !== parseInt(month) - 1 ||
    date.getDate() !== parseInt(day)
  ) {
    return null;
  }
  return date;
}

/**
 * Extract the date from a daily agenda filename.
 * Expected format: YYYY-MM-DD.md
 * Returns null if the filename doesn't match.
 */
export function extractDateFromDailyFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : null;
}

/**
 * Extract the date and title from a meeting note filename.
 * Expected format: YYYY-MM-DD - Title.md
 * Returns null if the filename doesn't match.
 */
export function extractDateAndTitleFromMeetingFilename(
  filename: string
): { date: string; title: string } | null {
  // Accept a few common separators:
  // - "YYYY-MM-DD - Title.md" (original)
  // - "YYYY-MM-DD — Title.md" / "YYYY-MM-DD – Title.md"
  // - "YYYY-MM-DD: Title.md"
  // - "YYYY-MM-DD Title.md" (no explicit separator)
  // - "YYYY-MM-DD.md" (no title)
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})(?:\s*(?:-{1,3}|–|—|:)\s*(.+)|\s+(.+))?\.md$/);
  if (!match) {
    return null;
  }

  const titleRaw = match[2] ?? match[3] ?? "";
  const title = titleRaw.trim() || "Untitled meeting";
  return { date: match[1], title };
}

/**
 * Check if a date string is within the lookback period from today.
 */
export function isWithinLookback(dateStr: string, lookbackDays: number): boolean {
  const date = parseDate(dateStr);
  if (!date) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  return date >= cutoff && date <= today;
}

/**
 * Get today's date as YYYY-MM-DD.
 */
export function getTodayDate(): string {
  return formatDate(new Date());
}

/**
 * Get a date N days ago as YYYY-MM-DD.
 */
export function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

/**
 * Calculate the number of days between two date strings.
 */
export function daysBetween(dateStr1: string, dateStr2: string): number {
  const date1 = parseDate(dateStr1);
  const date2 = parseDate(dateStr2);
  if (!date1 || !date2) {
    return 0;
  }
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
