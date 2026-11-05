import { cn } from './utils';

describe('cn', () => {
  it('drops falsy values', () => {
    expect(cn('a', undefined, null, false, 'c')).toBe('a c');
  });

  it('supports conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('lets later Tailwind utilities win', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
