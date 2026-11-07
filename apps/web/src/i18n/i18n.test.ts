import { firstNameFromEmail, habari, t } from './index';

describe('i18n layer', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('greeting.habari', { name: 'Grace' })).toBe('Habari, Grace');
    expect(t('common.page', { page: 2, pages: 5 })).toBe('Page 2 of 5');
    expect(t('greeting.habari')).toBe('Habari, {name}');
  });

  it('derives a friendly first name from the email, or none', () => {
    expect(firstNameFromEmail('grace.achieng@example.test')).toBe('Grace');
    expect(firstNameFromEmail('PETER_otieno@x.test')).toBe('Peter');
    expect(firstNameFromEmail('e2e-1234@x.test')).toBeNull();
    expect(firstNameFromEmail('a@x.test')).toBeNull();
    expect(habari('alice@acme.test')).toBe('Habari, Alice');
    expect(habari('42@x.test')).toBe('Habari');
    expect(habari(undefined)).toBe('Habari');
  });
});
