import childProcess from 'child_process';
import path from 'path';

describe('Austrian Airlines source-specific parsing', () => {
  it('keeps both Austrian legs in the non-LLM fixture pipeline', () => {
    const runnerPath = path.resolve(__dirname, '../scripts/nonLlmFixtureExtractionRunner.ts');
    const output = childProcess.execSync(`npx tsx "${runnerPath}"`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120000,
    });
    const match = output.match(/__FIXTURE_RESULTS_START__\r?\n([\s\S]*?)\r?\n__FIXTURE_RESULTS_END__/);
    if (!match) {
      throw new Error(`Fixture runner output was not parseable:\n${output}`);
    }

    const parsed = JSON.parse(match[1]) as Array<{ key: string; item: Record<string, unknown> | null }>;
    const austrian = parsed.find((entry) => entry.key === 'transfers/Austrian Air - Vicky - BOS to Vienna Round Trip - Oct 12 2024.pdf');

    expect(austrian?.item).toBeTruthy();
    const item = austrian?.item as Record<string, unknown>;
    const fields = (item.extractedFields as Record<string, unknown> | undefined) ?? {};

    expect(item.confirmationNumber).toBe('SQB7RX');
    expect(item.travelerNames).toEqual(['Vicky Duerk']);
    expect(fields.flightNumber).toBe('OS92');
    expect(fields.departureAirportCode).toBe('BOS');
    expect(fields.arrivalAirportCode).toBe('VIE');
    expect(fields.departureDate).toBe('2024-10-12');
    expect(fields.totalCost).toBe(610.7);
  });
});
