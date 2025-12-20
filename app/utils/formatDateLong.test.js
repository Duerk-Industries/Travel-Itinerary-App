import assert from 'assert';
import { formatDateLong } from './formatDateLong';

// Valid YYYY-MM-DD
assert.strictEqual(formatDateLong('2025-12-12'), 'Friday, Dec. 12, 2025');

// With time portion should strip time
assert.strictEqual(formatDateLong('2025-12-12T10:30:00Z').includes('Dec. 12, 2025'), true);

// Empty or invalid should gracefully return original or dash
assert.strictEqual(formatDateLong(''), '—');
assert.strictEqual(formatDateLong('not-a-date'), 'not-a-date');

console.log('formatDateLong tests passed');
