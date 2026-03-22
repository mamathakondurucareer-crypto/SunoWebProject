import cron from 'node-cron';
import { addMinutes } from 'date-fns';

/**
 * Match a single cron field value against a cron field pattern.
 * Supports: asterisk, n, asterisk/n, a-b, a,b,c, a-b/n, and comma-separated combinations.
 */
export function matchCronField(value: number, field: string): boolean {
  if (field === '*') return true;

  // Handle comma-separated lists
  const parts = field.split(',');
  for (const part of parts) {
    if (matchSingleField(value, part.trim())) return true;
  }
  return false;
}

/**
 * Match a single part (no commas).
 */
function matchSingleField(value: number, part: string): boolean {
  // Step with wildcard: asterisk/n
  if (part.startsWith('*/')) {
    const step = parseInt(part.slice(2), 10);
    if (isNaN(step)) return false;
    return value % step === 0;
  }

  // Range with optional step: a-b or a-b/n (excluding negatives)
  if (part.includes('-') && !part.startsWith('-')) {
    const [rangePart, stepPart] = part.split('/');
    const [startStr, endStr] = rangePart.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;

    const inRange = value >= start && value <= end;
    if (!inRange) return false;

    if (stepPart) {
      const step = parseInt(stepPart, 10);
      if (isNaN(step)) return false;
      return (value - start) % step === 0;
    }
    return true;
  }

  // Exact value
  const num = parseInt(part, 10);
  return !isNaN(num) && num === value;
}

/**
 * Validate a 5-field cron expression using node-cron's validator.
 */
export function validateCronExpression(expr: string): boolean {
  try {
    return cron.validate(expr);
  } catch {
    return false;
  }
}

/**
 * Compute the next date when a cron expression will fire, starting
 * strictly after `from` (default: now). Uses UTC for all time math.
 *
 * Returns null if expr is invalid or no match found within 4 years.
 */
export function computeNextCronDate(expr: string, from?: Date): Date | null {
  if (!validateCronExpression(expr)) return null;

  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;

  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  const start = new Date(from ?? new Date());
  start.setUTCSeconds(0);
  start.setUTCMilliseconds(0);

  // Start checking from the next minute
  let current = addMinutes(start, 1);
  const maxDate = addMinutes(start, 4 * 365 * 24 * 60);

  while (current <= maxDate) {
    if (matchesAllFields(current, minStr, hourStr, domStr, monStr, dowStr)) {
      return new Date(current);
    }
    current = addMinutes(current, 1);
  }

  return null;
}

/**
 * Collect all dates between `since` (exclusive) and `until` (inclusive)
 * where `expr` would have fired. Results capped at `maxRuns` (default 10).
 *
 * Used for missed-run detection when a recurring schedule didn't execute.
 */
export function computeMissedRuns(
  expr: string,
  since: Date,
  until: Date,
  maxRuns: number = 10,
): Date[] {
  if (!validateCronExpression(expr)) return [];

  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return [];

  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  const results: Date[] = [];
  let current = addMinutes(new Date(since), 1); // Start after since

  while (current <= until && results.length < maxRuns) {
    if (matchesAllFields(current, minStr, hourStr, domStr, monStr, dowStr)) {
      results.push(new Date(current));
    }
    current = addMinutes(current, 1);
  }

  return results;
}

/**
 * Check if a date matches all 5 cron fields.
 */
function matchesAllFields(
  date: Date,
  minStr: string,
  hourStr: string,
  domStr: string,
  monStr: string,
  dowStr: string,
): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // UTC month is 0-11, cron is 1-12
  const dayOfWeek = date.getUTCDay(); // 0=Sunday, 6=Saturday

  // Both DOM and DOW are wildcards: match either
  const domIsWildcard = domStr === '*';
  const dowIsWildcard = dowStr === '*';

  const matchesDom = domIsWildcard || matchCronField(dayOfMonth, domStr);
  const matchesDow = dowIsWildcard || matchCronField(dayOfWeek, dowStr);

  // If both are restricted (not wildcards), match either. Otherwise match both must be true.
  const dateMatch = domIsWildcard && dowIsWildcard ? true : domIsWildcard ? matchesDow : dowIsWildcard ? matchesDom : matchesDom || matchesDow;

  return (
    matchCronField(minute, minStr) &&
    matchCronField(hour, hourStr) &&
    dateMatch &&
    matchCronField(month, monStr)
  );
}
