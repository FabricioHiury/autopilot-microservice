import { createHash, timingSafeEqual, createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

export function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function matchesSecret(
  actual: unknown,
  expected: string | undefined,
): boolean {
  if (typeof actual !== 'string' || !expected) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function verifyMetaSignature(
  raw: Buffer,
  signature: string,
  secret: string,
): void {
  if (
    !raw ||
    !secret ||
    !matchesSecret(
      signature,
      'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    )
  ) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
export function retryDelay(attempt: number): number {
  return Math.min(300000, 1000 * 2 ** Math.min(attempt, 18));
}
