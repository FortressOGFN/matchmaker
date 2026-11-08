import crypto from 'crypto';

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function newUpperId(): string {
  return newId().toUpperCase();
}
