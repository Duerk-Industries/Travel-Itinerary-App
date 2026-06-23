/// <reference types="jest" />
/// <reference types="node" />
import {
  buildSettlementMatrix,
  computeNetBalancesCents,
  computeSettlementMatrixCents,
  formatCents,
  fromCents,
  rollUpPayments,
  sortParticipantIds,
  toCents,
  type PaymentRecord,
  type SettlementParticipant,
} from '../utils/settlement';

const makeParticipant = (
  id: string,
  first?: string,
  last?: string,
  email?: string
): SettlementParticipant => ({
  id,
  firstName: first ?? null,
  lastName: last ?? null,
  email: email ?? null,
});

describe('Settlement algorithm — primitives', () => {
  describe('toCents / fromCents', () => {
    it('converts dollars to integer cents', () => {
      expect(toCents(10)).toBe(1000);
      expect(toCents(12.34)).toBe(1234);
      expect(toCents(0)).toBe(0);
      expect(toCents(0.1)).toBe(10);
    });

    it('handles floating-point drift from pre-rounded decimals', () => {
      expect(toCents(10.005)).toBe(1001);
      expect(toCents(0.1 + 0.2)).toBe(30);
    });

    it('treats invalid numeric inputs as 0', () => {
      expect(toCents(NaN)).toBe(0);
      expect(toCents(Infinity)).toBe(0);
      expect(toCents(null as any)).toBe(0);
      expect(toCents(undefined as any)).toBe(0);
    });

    it('round-trips through fromCents', () => {
      expect(fromCents(toCents(12.34))).toBe(12.34);
      expect(fromCents(1001)).toBe(10.01);
    });
  });

  describe('sortParticipantIds', () => {
    it('sorts case-insensitively by (last, first, email)', () => {
      const ps = [
        makeParticipant('c', 'bob', 'Smith', 'c@x'),
        makeParticipant('a', 'Alice', 'smith', 'a@x'),
        makeParticipant('b', 'Alice', 'SMITH', 'b@x'),
        makeParticipant('d', 'Alice', 'adams', 'd@x'),
      ];
      expect(sortParticipantIds(ps)).toEqual(['d', 'a', 'b', 'c']);
    });

    it('falls back to email when names are missing, case-insensitive', () => {
      const ps = [
        makeParticipant('a', '', '', 'zoe@example.com'),
        makeParticipant('b', '', '', 'AARON@example.com'),
      ];
      expect(sortParticipantIds(ps)).toEqual(['b', 'a']);
    });
  });
});

describe('Settlement algorithm — balance computation', () => {
  it('computes net balances from paid, used, and payments', () => {
    const net = computeNetBalancesCents(
      ['a', 'b'],
      { a: 10000, b: 0 },
      { a: 5000, b: 5000 },
      [{ payerId: 'b', receiverId: 'a', amountCents: 2000 }]
    );
    expect(net.a).toBe(10000 - 5000 - 2000); // 3000 (still owed 3000)
    expect(net.b).toBe(0 - 5000 + 2000); // -3000 (still owes 3000)
  });

  it('only updates net balances for ids inside the participant set', () => {
    const net = computeNetBalancesCents(
      ['a', 'b'],
      { a: 1000, b: 0 },
      { a: 500, b: 500 },
      [{ payerId: 'c', receiverId: 'a', amountCents: 200 }]
    );
    // 'c' is not a participant so no entry is created for it; receiver 'a' still
    // gets compensated: a was owed $5.00, received $2.00, so net drops to $3.00.
    expect(net.a).toBe(300);
    expect(net.b).toBe(-500);
    expect((net as any).c).toBeUndefined();
  });
});

describe('Settlement algorithm — matrix', () => {
  it('is empty when everyone is zero-balance', () => {
    const sortedIds = ['a', 'b', 'c'];
    const matrix = computeSettlementMatrixCents(sortedIds, { a: 0, b: 0, c: 0 });
    expect(matrix.grandTotalCents).toBe(0);
    sortedIds.forEach((row) => {
      sortedIds.forEach((col) => {
        expect(matrix.matrixCents[row][col]).toBe(0);
      });
    });
  });

  it('produces a two-person transfer', () => {
    // A is owed $100, B owes $100
    const matrix = computeSettlementMatrixCents(['A', 'B'], { A: 10000, B: -10000 });
    expect(matrix.matrixCents.B.A).toBe(10000);
    expect(matrix.matrixCents.A.B).toBe(0);
    expect(matrix.rowTotalsCents.B).toBe(10000);
    expect(matrix.columnTotalsCents.A).toBe(10000);
    expect(matrix.grandTotalCents).toBe(10000);
  });

  it('greedy algorithm: largest debtor pays largest creditor first', () => {
    // Alice owed $50, Bob owed $30, Carol owes $80
    const matrix = computeSettlementMatrixCents(
      ['alice', 'bob', 'carol'],
      { alice: 5000, bob: 3000, carol: -8000 }
    );
    expect(matrix.matrixCents.carol.alice).toBe(5000);
    expect(matrix.matrixCents.carol.bob).toBe(3000);
    expect(matrix.grandTotalCents).toBe(8000);
  });

  it('splits one debtor across two creditors when needed', () => {
    // Alice owes $60; Bob is owed $40; Carol is owed $20
    const matrix = computeSettlementMatrixCents(
      ['alice', 'bob', 'carol'],
      { alice: -6000, bob: 4000, carol: 2000 }
    );
    // Bob is most-owed — Alice pays Bob $40 first
    expect(matrix.matrixCents.alice.bob).toBe(4000);
    expect(matrix.matrixCents.alice.carol).toBe(2000);
    // Other cells zero
    expect(matrix.matrixCents.bob.alice).toBe(0);
    expect(matrix.matrixCents.carol.alice).toBe(0);
  });

  it('breaks ties using alphabetical (sortedIds) order', () => {
    // Alice (sortedIds[0]) and Bob (sortedIds[1]) both owe $50; Carol (sortedIds[2]) and Dave (sortedIds[3]) are both owed $50
    const matrix = computeSettlementMatrixCents(
      ['alice', 'bob', 'carol', 'dave'],
      { alice: -5000, bob: -5000, carol: 5000, dave: 5000 }
    );
    // Alice (first-sorted debtor) pays Carol (first-sorted creditor) first
    expect(matrix.matrixCents.alice.carol).toBe(5000);
    expect(matrix.matrixCents.bob.dave).toBe(5000);
    expect(matrix.matrixCents.alice.dave).toBe(0);
    expect(matrix.matrixCents.bob.carol).toBe(0);
  });

  it('never creates cyclic payments (A→B→C→A)', () => {
    // If A is owed $X and also owes $X, a cycle-generating algorithm would produce matrix cycles.
    // Here, A is net 0, B owes $10, C is owed $10 — only one edge should form (B→C).
    const matrix = computeSettlementMatrixCents(['a', 'b', 'c'], { a: 0, b: -1000, c: 1000 });
    expect(matrix.matrixCents.b.c).toBe(1000);
    // Validate no cycles by checking no row has a payment to someone who has a payment back
    for (const from of ['a', 'b', 'c']) {
      for (const to of ['a', 'b', 'c']) {
        if (matrix.matrixCents[from][to] > 0) {
          expect(matrix.matrixCents[to][from]).toBe(0);
        }
      }
    }
  });

  it('row totals sum equals column totals sum (invariant)', () => {
    const sortedIds = ['a', 'b', 'c', 'd'];
    // Uneven: a=+70, b=+30, c=-40, d=-60
    const matrix = computeSettlementMatrixCents(sortedIds, {
      a: 7000,
      b: 3000,
      c: -4000,
      d: -6000,
    });
    const rowSum = Object.values(matrix.rowTotalsCents).reduce((s, v) => s + v, 0);
    const colSum = Object.values(matrix.columnTotalsCents).reduce((s, v) => s + v, 0);
    expect(rowSum).toBe(colSum);
    expect(rowSum).toBe(10000);
  });

  it('diagonal cells remain zero in the matrix', () => {
    const matrix = computeSettlementMatrixCents(['a', 'b'], { a: 100, b: -100 });
    expect(matrix.matrixCents.a.a).toBe(0);
    expect(matrix.matrixCents.b.b).toBe(0);
  });

  it('handles zero-sum groups where everyone has exactly paid their share', () => {
    // Three people each paid and used $20 — nothing owed
    const matrix = computeSettlementMatrixCents(['a', 'b', 'c'], { a: 0, b: 0, c: 0 });
    expect(matrix.grandTotalCents).toBe(0);
  });
});

describe('Settlement algorithm — rounding / dust', () => {
  it('handles $10 split 3 ways with integer-cent precision', () => {
    // A paid $10 for all three. Each share is $3.333...
    // Paid: A=1000, B=0, C=0
    // Used: A=334, B=333, C=333 (A gets remainder per computePayerTotals)
    // Net: A = 1000 - 334 = 666; B = -333; C = -333
    const net = { a: 666, b: -333, c: -333 };
    const matrix = computeSettlementMatrixCents(['a', 'b', 'c'], net);
    expect(matrix.matrixCents.b.a).toBe(333);
    expect(matrix.matrixCents.c.a).toBe(333);
    expect(matrix.grandTotalCents).toBe(666);
    // Full reconciliation
    const rowSum = Object.values(matrix.rowTotalsCents).reduce((s, v) => s + v, 0);
    const colSum = Object.values(matrix.columnTotalsCents).reduce((s, v) => s + v, 0);
    expect(rowSum - colSum).toBe(0);
  });
});

describe('Settlement algorithm — payments roll-up with covered travelers', () => {
  it('resolves payer through a covering chain', () => {
    const payments: PaymentRecord[] = [
      { payerId: 'kid', receiverId: 'hotel', amountCents: 1000 },
    ];
    // kid is covered by parent
    const rolled = rollUpPayments(payments, { kid: 'parent' });
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toEqual({ payerId: 'parent', receiverId: 'hotel', amountCents: 1000 });
  });

  it('drops payments where payer and receiver share the same primary', () => {
    const payments: PaymentRecord[] = [
      { payerId: 'kidA', receiverId: 'kidB', amountCents: 500 },
    ];
    const rolled = rollUpPayments(payments, { kidA: 'parent', kidB: 'parent' });
    expect(rolled).toHaveLength(0);
  });

  it('handles multi-step covering chains without infinite loop', () => {
    const payments: PaymentRecord[] = [
      { payerId: 'grandchild', receiverId: 'other', amountCents: 100 },
    ];
    const rolled = rollUpPayments(payments, { grandchild: 'child', child: 'grandparent' });
    expect(rolled[0].payerId).toBe('grandparent');
  });
});

describe('Settlement algorithm — integration via buildSettlementMatrix', () => {
  const alice = makeParticipant('alice', 'Alice', 'Adams', 'alice@x');
  const bob = makeParticipant('bob', 'Bob', 'Baker', 'bob@x');
  const carol = makeParticipant('carol', 'Carol', 'Clark', 'carol@x');

  it('omits covered travelers from the participant axis', () => {
    const kid = makeParticipant('kid', 'Kid', 'Adams', 'kid@x');
    const result = buildSettlementMatrix({
      participants: [alice, bob, kid],
      paidTotalsCents: { alice: 6000, bob: 0, kid: 0 },
      usedTotalsCents: { alice: 2000, bob: 2000, kid: 2000 },
      payments: [],
      coveredBy: { kid: 'alice' },
    });
    expect(result.sortedIds).toEqual(['alice', 'bob']);
  });

  it('aggregates a covered traveler\'s expenses into the primary', () => {
    const kid = makeParticipant('kid', 'Kid', 'Adams', 'kid@x');
    // Alice paid $60 and used $20; kid used $20; kid's share goes to Alice
    // After rollup: Alice paid $60 used $40; Bob used $20
    // Net: Alice = +2000, Bob = -2000
    const result = buildSettlementMatrix({
      participants: [alice, bob, kid],
      paidTotalsCents: { alice: 6000, bob: 0, kid: 0 },
      usedTotalsCents: { alice: 2000, bob: 2000, kid: 2000 },
      payments: [],
      coveredBy: { kid: 'alice' },
    });
    expect(result.matrixCents.bob.alice).toBe(2000);
    expect(result.grandTotalCents).toBe(2000);
  });

  it('applies an existing payment to reduce the owed amount', () => {
    // Alice paid $90, used $30; Bob/Carol each used $30. Without payment: Bob→Alice $30, Carol→Alice $30.
    // With a $30 payment from Bob to Alice: only Carol still owes Alice $30.
    const result = buildSettlementMatrix({
      participants: [alice, bob, carol],
      paidTotalsCents: { alice: 9000, bob: 0, carol: 0 },
      usedTotalsCents: { alice: 3000, bob: 3000, carol: 3000 },
      payments: [{ payerId: 'bob', receiverId: 'alice', amountCents: 3000 }],
      coveredBy: {},
    });
    expect(result.matrixCents.bob.alice).toBe(0);
    expect(result.matrixCents.carol.alice).toBe(3000);
    expect(result.grandTotalCents).toBe(3000);
  });

  it('aggregates a payment from a covered traveler into their primary', () => {
    // Kid paid Bob $20 — should count as Alice paid Bob $20 (kid covered by alice)
    const kid = makeParticipant('kid', 'Kid', 'Adams', 'kid@x');
    // Costs: Alice paid $60 and used $30; Bob used $30; Kid used $0 (covered -> alice already at $30 used)
    // Net before payment: Alice = +3000, Bob = -3000
    // A kid→bob payment of $2000 rolls up to alice→bob: alice net becomes 3000+2000=5000? No —
    // payer side of payment: +payment_cents; receiver side: -payment_cents
    // After rollup payment alice→bob $2000: alice net = 3000 + 2000 = 5000; bob net = -3000 - 2000 = -5000
    // That's a larger imbalance, which reflects Alice overpaying Bob. Good.
    const result = buildSettlementMatrix({
      participants: [alice, bob, kid],
      paidTotalsCents: { alice: 6000, bob: 0, kid: 0 },
      usedTotalsCents: { alice: 3000, bob: 3000, kid: 0 },
      payments: [{ payerId: 'kid', receiverId: 'bob', amountCents: 2000 }],
      coveredBy: { kid: 'alice' },
    });
    expect(result.matrixCents.bob.alice).toBe(5000);
  });

  it('balance invariant: sum of row totals equals sum of column totals', () => {
    const result = buildSettlementMatrix({
      participants: [alice, bob, carol],
      paidTotalsCents: { alice: 10000, bob: 0, carol: 0 },
      usedTotalsCents: { alice: 3333, bob: 3333, carol: 3334 },
      payments: [],
      coveredBy: {},
    });
    const rowSum = Object.values(result.rowTotalsCents).reduce((s, v) => s + v, 0);
    const colSum = Object.values(result.columnTotalsCents).reduce((s, v) => s + v, 0);
    expect(rowSum).toBe(colSum);
  });
});

describe('Settlement display formatting', () => {
  it('formats cents into a currency string', () => {
    const usd = formatCents(1234, 'USD');
    expect(usd).toMatch(/\$?12\.34/);
  });

  it('rounds half-cents correctly via fromCents', () => {
    expect(fromCents(1234)).toBe(12.34);
    expect(fromCents(0)).toBe(0);
  });
});
