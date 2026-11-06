import { safeNext } from './safe-next';

describe('safeNext', () => {
  it.each([
    ['/invitations/accept', '/invitations/accept'],
    [null, '/'],
    ['//evil.example/x', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
