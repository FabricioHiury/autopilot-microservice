import { createHmac } from 'crypto';
import { ErrorResponse } from '../../base/exceptions/error.response.handler';
import { FacebookDeleteDataPayload } from './facebook.interfaces';

/**
 * Parse signed request from Facebook
 */
function parseSignedRequest(signedRequest: string) {
  const [encodedSignature, payload] = signedRequest.split('.', 2);

  const receivedSignature = formatSignature(encodedSignature);

  const data: FacebookDeleteDataPayload = JSON.parse(decodeUrlBase64(payload));

  const calculatedSignature = generateSignature(payload);

  if (receivedSignature !== calculatedSignature) {
    console.error('Invalid signature.');
    return null;
  }

  return data;
}

/**
 * Format signature from Facebook
 */
function formatSignature(signature: string) {
  return signature.replace(/-/g, '+').replace(/_/g, '/') + '=';
}

/**
 * Decode URL-safe base64 string
 */
function decodeUrlBase64(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generate signature for payload validation
 */
function generateSignature(payload: string): string {
  const secret = process.env.META_APP_SECRET;
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('base64');
}

/**
 * Validate payload signature from Facebook
 */
function validatePayloadSignature(
  rawPayload: Buffer,
  receivedSignature: string,
) {
  receivedSignature = receivedSignature.replace('sha256=', '');

  const secret = process.env.META_APP_SECRET;

  const payloadStr = rawPayload.toString('utf-8');

  const escapeUnicode = (input: string) => {
    return input.replace(/[\u0080-\uFFFF]/g, (match) => {
      return '\\u' + ('0000' + match.charCodeAt(0).toString(16)).slice(-4);
    });
  };

  const escapedPayload = escapeUnicode(payloadStr);
  const calculatedSignature = createHmac('sha256', secret)
    .update(escapedPayload)
    .digest('hex');

  if (receivedSignature !== calculatedSignature) {
    throw new ErrorResponse('Error validating signature', 401);
  }
}

export const facebookUtils = {
  parseSignedRequest,
  decodeUrlBase64,
  generateSignature,
  validatePayloadSignature,
};
