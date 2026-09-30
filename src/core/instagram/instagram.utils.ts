import { createHmac } from 'crypto';
import { InstagramDeleteDataPayload } from './instagram.interfaces';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';

function parseSignedRequest(signedRequest: string) {
  const [encodedSignature, payload] = signedRequest.split('.', 2);

  const receivedSignature = formatSignature(encodedSignature);

  const data: InstagramDeleteDataPayload = JSON.parse(
    decodeUrlBase64(payload),
  );

  const calculatedSignature = generateSignature(payload);

  if (receivedSignature !== calculatedSignature) {
    console.error('Invalid signature.');
    return null;
  }

  return data;
}

function formatSignature(signature: string) {
  return signature.replace(/-/g, '+').replace(/_/g, '/') + '=';
}

function decodeUrlBase64(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(base64, 'base64').toString('utf8');
}

function generateSignature(payload: string): string {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('base64');
}

function setTokenExpiration(expiresIn: number) {
  const tokenExpirationDate = new Date();
  tokenExpirationDate.setSeconds(tokenExpirationDate.getSeconds() + expiresIn);

  return tokenExpirationDate;
}

function validatePayloadSignature(rawPayload: Buffer | string | undefined, receivedSignature?: string) {
  if (!receivedSignature) {
    throw new ErrorResponse('Missing signature header', 401);
  }

  if (!rawPayload) {
    throw new ErrorResponse('Missing request body', 400);
  }

  const normalizedSignature = receivedSignature.replace('sha256=', '');
  const secret = process.env.INSTAGRAM_APP_SECRET;

  if (!secret) {
    throw new ErrorResponse('Instagram app secret not configured', 500);
  }

  const payloadBuffer = Buffer.isBuffer(rawPayload)
    ? rawPayload
    : Buffer.from(rawPayload);

  const calculatedSignature = createHmac('sha256', secret)
    .update(payloadBuffer)
    .digest('hex');

  if (normalizedSignature !== calculatedSignature) {
    throw new ErrorResponse('Error validating signature', 401);
  }
}

export const instagramUtils = {
  parseSignedRequest,
  base64UrlDecode: decodeUrlBase64,
  generateSignature,
  setTokenExpiration,
  validatePayloadSignature,
};
