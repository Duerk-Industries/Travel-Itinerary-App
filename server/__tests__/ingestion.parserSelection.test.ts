import { normalizeMimeType } from '../src/ingestion/shared/parserSelection';

describe('ingestion parser selection', () => {
  it('falls back to the filename extension when the browser sends application/octet-stream', () => {
    expect(normalizeMimeType('application/octet-stream', 'booking.pdf')).toBe('application/pdf');
    expect(normalizeMimeType('application/octet-stream', 'confirmation.html')).toBe('text/html');
    expect(normalizeMimeType('application/octet-stream', 'message.txt')).toBe('text/plain');
  });

  it('preserves specific supported mime types when they are already present', () => {
    expect(normalizeMimeType('application/pdf', 'booking.bin')).toBe('application/pdf');
    expect(normalizeMimeType('text/html', 'booking.pdf')).toBe('text/html');
  });
});
