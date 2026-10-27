import {relativeTime} from '../../../shared/app-data/values.js';

const UNITS = ['B', 'KB', 'MB', 'GB'];

/** A size as people read it: 512 B, 1.2 KB, 24 MB. */
export function formatSize(bytes) {
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** "in 14 min" or "2 h ago", in the person's language. */
export function formatRelative(t, ms, now = Date.now()) {
  const {past, count, unit} = relativeTime(ms, now);
  const amount = t(`dataUnit_${unit}`, {count});
  return past ? t('dataAgo', {amount}) : t('dataIn', {amount});
}

/** A moment as a local date and time. */
export const formatMoment = (ms) => new Date(ms).toLocaleString();

/** The time of day of a change in the feed. */
export const formatClock = (ms) => new Date(ms).toLocaleTimeString();
