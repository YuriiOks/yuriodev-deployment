import { describe, expect, it } from 'vitest';
import { ApiError } from './liveApi';
import { refusal } from './recurringApi';
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
});
