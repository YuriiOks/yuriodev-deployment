import { describe, expect, it } from 'vitest';
import { ApiError } from './liveApi';
import { refusal, refusalIssues } from './recurringApi';
import { limitOf, parseLimits } from './limits';
import { REFUSAL_EN, REFUSAL_RU } from './refusalStrings';

describe('refusal: a refusal is told in the page\'s own words, never the server\'s text', () => {
  it('maps the error code of a 4xx to the page\'s words in each language', () => {
    const error = new ApiError('validation_error', 422, 'amount must be positive');
    expect(refusal(error, REFUSAL_EN)).toBe('check the values you entered');
    expect(refusal(error, REFUSAL_RU)).toBe('проверьте введённые значения');
  });

  it('never returns the server\'s message, and says nothing for a code it has no words for', () => {
    expect(refusal(new ApiError('something_new', 422, 'a sentence the server wrote'), REFUSAL_EN)).toBeNull();
    expect(refusal(new ApiError('http', 400, 'HTTP 400'), REFUSAL_EN)).toBeNull();
  });

  it('says nothing for a server failure or a lost connection', () => {
    expect(refusal(new ApiError('validation_error', 500, 'x'), REFUSAL_EN)).toBeNull();
    expect(refusal(new ApiError('network', 0, 'network'), REFUSAL_EN)).toBeNull();
    expect(refusal(new Error('x'), REFUSAL_EN)).toBeNull();
  });

  it('uses the finer code (reason) when there is one, and any "<thing>_not_found" as "no longer exists"', () => {
    expect(refusal(new ApiError('conflict', 409, 'x', { reason: 'payment_moved_on' }), REFUSAL_EN)).toBe('the payment has already moved on');
    expect(refusal(new ApiError('not_found', 404, 'x', { reason: 'recurring_payment_not_found' }), REFUSAL_EN)).toBe('it no longer exists');
    expect(refusal(new ApiError('validation_error', 422, 'x', { reason: 'as_of_future' }), REFUSAL_RU)).toBe('дата ещё не наступила');
  });

  it('tells each broken rule of a 422 under its field\'s own name, with the number that was broken', () => {
    const error = new ApiError('validation_error', 422, 'x', {
      issues: [
        { field: 'name', code: 'too_long', limit: 120, bound: null },
        { field: 'items.0.amount', code: 'out_of_range', limit: 1, bound: 'min' },
        { field: 'body', code: 'bad_json', limit: null, bound: null },
      ],
    });
    expect(refusalIssues(error, REFUSAL_EN)).toEqual(['name: at most 120 characters', 'amount: at least 1', 'the data could not be read']);
    expect(refusal(error, REFUSAL_EN)).toBe('name: at most 120 characters; amount: at least 1; the data could not be read');
    expect(refusalIssues(error, REFUSAL_RU)[0]).toBe('название: не длиннее 120 знаков');
  });

  it('keeps only the first three issues and never the server\'s text for a code it does not know', () => {
    const many = new ApiError('validation_error', 422, 'x', { issues: [1, 2, 3, 4, 5].map(() => ({ field: 'q', code: 'something_new', limit: null, bound: null })) });
    expect(refusalIssues(many, REFUSAL_EN)).toHaveLength(3);
    expect(refusalIssues(many, REFUSAL_EN)[0]).toBe('search: cannot be used');
  });
});

describe('the limits of the server', () => {
  it('keeps only whole non-negative numbers, and falls back for a limit it does not carry', () => {
    const limits = parseLimits({ task: { title: 300, notes: -1 }, recurring: { name: 120, amount: 1.5 }, junk: 5, other: { x: 'y' } });
    expect(limits).toEqual({ task: { title: 300 }, recurring: { name: 120 } });
    expect(limitOf(limits, 'task', 'title', 10)).toBe(300);
    expect(limitOf(limits, 'task', 'notes', 10)).toBe(10);
    expect(limitOf(parseLimits(null), 'project', 'name', 80)).toBe(80);
  });
});
