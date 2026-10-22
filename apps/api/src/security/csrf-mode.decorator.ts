import { SetMetadata } from '@nestjs/common';

export const CSRF_MODE_KEY = 'csrfMode';
export type CsrfMode = 'exempt' | 'refresh' | 'logout';
export const CsrfMode = (mode: CsrfMode) => SetMetadata(CSRF_MODE_KEY, mode);
