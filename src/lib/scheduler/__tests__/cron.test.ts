import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { matchCronField, validateCronExpression, computeNextCronDate, computeMissedRuns } from '../cron';

describe('matchCronField', () => {
  describe('wildcard *', () => {
    it('matches any value', () => {
      assert.ok(matchCronField(0, '*'));
      assert.ok(matchCronField(30, '*'));
      assert.ok(matchCronField(59, '*'));
    });
  });

  describe('exact value', () => {
    it('matches 5 exactly', () => {
      assert.ok(matchCronField(5, '5'));
      assert.ok(!matchCronField(4, '5'));
      assert.ok(!matchCronField(6, '5'));
    });
  });

  describe('step */n', () => {
    it('matches */5 for 0, 5, 10, 15...', () => {
      assert.ok(matchCronField(0, '*/5'));
      assert.ok(matchCronField(5, '*/5'));
      assert.ok(matchCronField(10, '*/5'));
      assert.ok(matchCronField(15, '*/5'));
      assert.ok(!matchCronField(3, '*/5'));
      assert.ok(!matchCronField(7, '*/5'));
    });
  });

  describe('range a-b', () => {
    it('matches 0-5', () => {
      assert.ok(matchCronField(0, '0-5'));
      assert.ok(matchCronField(3, '0-5'));
      assert.ok(matchCronField(5, '0-5'));
      assert.ok(!matchCronField(6, '0-5'));
    });
  });

  describe('list a,b,c', () => {
    it('matches 1,3,5', () => {
      assert.ok(matchCronField(1, '1,3,5'));
      assert.ok(matchCronField(3, '1,3,5'));
      assert.ok(matchCronField(5, '1,3,5'));
      assert.ok(!matchCronField(2, '1,3,5'));
      assert.ok(!matchCronField(6, '1,3,5'));
    });
  });

  describe('range with step a-b/n', () => {
    it('matches 0-10/2 for 0,2,4,6,8,10', () => {
      assert.ok(matchCronField(0, '0-10/2'));
      assert.ok(matchCronField(2, '0-10/2'));
      assert.ok(matchCronField(4, '0-10/2'));
      assert.ok(matchCronField(6, '0-10/2'));
      assert.ok(matchCronField(8, '0-10/2'));
      assert.ok(matchCronField(10, '0-10/2'));
      assert.ok(!matchCronField(1, '0-10/2'));
      assert.ok(!matchCronField(3, '0-10/2'));
    });
  });

  describe('comma with range a,b-c', () => {
    it('matches 1,3-5', () => {
      assert.ok(matchCronField(1, '1,3-5'));
      assert.ok(matchCronField(3, '1,3-5'));
      assert.ok(matchCronField(4, '1,3-5'));
      assert.ok(matchCronField(5, '1,3-5'));
      assert.ok(!matchCronField(2, '1,3-5'));
      assert.ok(!matchCronField(6, '1,3-5'));
    });
  });

  it('returns false for invalid field', () => {
    assert.ok(!matchCronField(5, 'invalid'));
  });
});

describe('validateCronExpression', () => {
  it('validates * * * * *', () => {
    assert.ok(validateCronExpression('* * * * *'));
  });

  it('validates 0 9 * * 1 (Monday 9am)', () => {
    assert.ok(validateCronExpression('0 9 * * 1'));
  });

  it('validates */15 * * * * (every 15min)', () => {
    assert.ok(validateCronExpression('*/15 * * * *'));
  });

  it('validates 0 0 1 1 * (Jan 1)', () => {
    assert.ok(validateCronExpression('0 0 1 1 *'));
  });

  it('rejects invalid', () => {
    assert.ok(!validateCronExpression('invalid'));
  });

  it('rejects 4-field cron', () => {
    assert.ok(!validateCronExpression('* * * *'));
  });

  it('rejects 60 in minute field', () => {
    assert.ok(!validateCronExpression('60 * * * *'));
  });
});

describe('computeNextCronDate', () => {
  it('returns null for invalid cron', () => {
    const result = computeNextCronDate('invalid');
    assert.equal(result, null);
  });

  it('computes next minute for * * * * *', () => {
    const from = new Date('2026-03-22T10:15:30.000Z');
    const result = computeNextCronDate('* * * * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 16);
    assert.equal(result!.getUTCHours(), 10);
    assert.equal(result!.getUTCDate(), 22);
  });

  it('computes top of next hour for 0 * * * *', () => {
    const from = new Date('2026-03-22T12:05:00.000Z');
    const result = computeNextCronDate('0 * * * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 0);
    assert.equal(result!.getUTCHours(), 13);
  });

  it('computes 9am next day for 0 9 * * *', () => {
    const from = new Date('2026-03-22T10:00:00.000Z');
    const result = computeNextCronDate('0 9 * * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 0);
    assert.equal(result!.getUTCHours(), 9);
    assert.equal(result!.getUTCDate(), 23);
  });

  it('computes Jan 1 midnight for 0 0 1 1 *', () => {
    const from = new Date('2026-06-15T12:00:00.000Z');
    const result = computeNextCronDate('0 0 1 1 *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 0);
    assert.equal(result!.getUTCHours(), 0);
    assert.equal(result!.getUTCDate(), 1);
    assert.equal(result!.getUTCMonth(), 0); // January is month 0
  });

  it('computes next Monday 9am for 0 9 * * 1', () => {
    // March 22, 2026 is a Sunday
    const from = new Date('2026-03-22T10:00:00.000Z');
    const result = computeNextCronDate('0 9 * * 1', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 0);
    assert.equal(result!.getUTCHours(), 9);
    // Should land on a Monday (day of week 1)
    assert.equal(result!.getUTCDay(), 1);
  });
});

describe('computeMissedRuns', () => {
  it('returns empty array for invalid cron', () => {
    const since = new Date('2026-03-22T10:00:00.000Z');
    const until = new Date('2026-03-22T10:05:00.000Z');
    const result = computeMissedRuns('invalid', since, until);
    assert.deepEqual(result, []);
  });

  it('returns 5 dates for every minute over 5-min window', () => {
    const since = new Date('2026-03-22T10:00:00.000Z');
    const until = new Date('2026-03-22T10:05:00.000Z');
    const result = computeMissedRuns('* * * * *', since, until);
    assert.equal(result.length, 5);
    // Verify timestamps are 1 minute apart
    for (let i = 1; i < result.length; i++) {
      const diff = result[i].getTime() - result[i - 1].getTime();
      assert.equal(diff, 60000); // 1 minute
    }
  });

  it('returns 3 runs for hourly from 12:00 to 15:00', () => {
    const since = new Date('2026-03-22T12:00:00.000Z');
    const until = new Date('2026-03-22T15:00:00.000Z');
    const result = computeMissedRuns('0 * * * *', since, until);
    assert.equal(result.length, 3);
    assert.equal(result[0]!.getUTCHours(), 13);
    assert.equal(result[1]!.getUTCHours(), 14);
    assert.equal(result[2]!.getUTCHours(), 15);
  });

  it('respects maxRuns cap', () => {
    const since = new Date('2026-03-22T10:00:00.000Z');
    const until = new Date('2026-03-22T10:20:00.000Z');
    const result = computeMissedRuns('* * * * *', since, until, 3);
    assert.equal(result.length, 3);
  });

  it('returns empty array if since >= until', () => {
    const since = new Date('2026-03-22T10:05:00.000Z');
    const until = new Date('2026-03-22T10:00:00.000Z');
    const result = computeMissedRuns('* * * * *', since, until);
    assert.deepEqual(result, []);
  });
});

describe('Recurring-logic integration', () => {
  it('computeNextCronDate for */30 min returns :30 or :00', () => {
    const from = new Date('2026-03-22T10:00:00.000Z');
    const result = computeNextCronDate('*/30 * * * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 30);
  });

  it('computeNextCronDate for */30 from :30 returns :00 next hour', () => {
    const from = new Date('2026-03-22T10:30:00.000Z');
    const result = computeNextCronDate('*/30 * * * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCMinutes(), 0);
    assert.equal(result!.getUTCHours(), 11);
  });

  it('computeNextCronDate for weekly Sunday returns a Sunday', () => {
    const from = new Date('2026-03-22T10:00:00.000Z'); // Sunday
    const result = computeNextCronDate('0 0 * * 0', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCDay(), 0); // Sunday
  });

  it('computeNextCronDate for monthly day 1 returns day 1', () => {
    const from = new Date('2026-03-22T10:00:00.000Z');
    const result = computeNextCronDate('0 0 1 * *', from);
    assert.ok(result !== null);
    assert.equal(result!.getUTCDate(), 1);
  });
});
