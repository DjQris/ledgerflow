import { describe, expect, it } from 'vitest';

import { safeNextPath } from './types';

describe('safe post-login redirects', () => {
  it('allows only exact internal routes for the signed-in role', () => {
    expect(safeNextPath('/wallets', 'CUSTOMER')).toBe('/wallets');
    expect(safeNextPath('/operations/users', 'ADMIN')).toBe('/operations/users');
    expect(safeNextPath('/operations/users', 'OPERATIONS')).toBe('/dashboard');
    expect(safeNextPath('/operations', 'CUSTOMER')).toBe('/dashboard');
    expect(safeNextPath('//evil.example', 'ADMIN')).toBe('/dashboard');
    expect(safeNextPath('javascript:alert(1)', 'ADMIN')).toBe('/dashboard');
    expect(safeNextPath('/wallets?next=//evil.example', 'CUSTOMER')).toBe('/dashboard');
  });
});
