/// <reference types="jest" />
/// <reference types="node" />
import { calculateCostRow, generateCostModelRows, parseCostModelConfig, rowsToCsv } from '../src/costModel';

const config = parseCostModelConfig({
  settings: { rowStep: 100, maxUsers: 200 },
  userMix: { Basic: 0.75, Premium: 0.25 },
  usagePerUser: {
    Basic: {
      openai: { input_tokens: 1000, output_tokens: 500 },
      googleCloudHosting: { requests: 10 },
    },
    Premium: {
      openai: { input_tokens: 3000, output_tokens: 1500 },
      googleCloudHosting: { requests: 30 },
    },
  },
  costSources: [
    { id: 'hosting_base', type: 'fixed', monthlyCostUsd: 10 },
    {
      id: 'hosting_usage',
      type: 'variable',
      api: 'googleCloudHosting',
      usageLevels: [{ metric: 'requests', unitCostUsd: 1, perUnits: 100 }],
    },
    {
      id: 'openai',
      type: 'variable',
      api: 'openai',
      usageLevels: [
        { metric: 'input_tokens', unitCostUsd: 2, perUnits: 1000 },
        { metric: 'output_tokens', unitCostUsd: 4, perUnits: 1000 },
      ],
    },
  ],
});

describe('cost model', () => {
  it('calculates fixed, variable, and total costs from blended user usage', () => {
    const row = calculateCostRow(config, 100);

    expect(row.fixedCostUsd).toBe(10);
    expect(row.sourceCostsUsd.hosting_usage).toBe(15);
    expect(row.sourceCostsUsd.openai).toBe(600);
    expect(row.variableCostUsd).toBe(615);
    expect(row.totalCostUsd).toBe(625);
  });

  it('generates rows using the configured row step and max users', () => {
    expect(generateCostModelRows(config).map((row) => row.users)).toEqual([0, 100, 200]);
  });

  it('renders a csv with summary and per-source columns', () => {
    const csv = rowsToCsv(generateCostModelRows(config), config);

    expect(csv.split('\n')[0]).toBe(
      'users,fixed_cost_usd,variable_cost_usd,total_cost_usd,hosting_base_usd,hosting_usage_usd,openai_usd'
    );
    expect(csv).toContain('100,10,615,625,10,15,600');
  });

  it('rejects user mixes that do not total 1', () => {
    expect(() =>
      parseCostModelConfig({
        settings: { rowStep: 100, maxUsers: 100 },
        userMix: { Basic: 0.5, Premium: 0.6 },
        usagePerUser: { Basic: {}, Premium: {} },
        costSources: [],
      })
    ).toThrow(/userMix percentages must total 1/);
  });
});
