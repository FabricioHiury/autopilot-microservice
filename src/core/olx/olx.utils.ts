import { ErrorResponse } from '../../base/exceptions/error.response.handler';

type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope';

const ERROR_MAP = {
  invalid_request: {
    status: 400,
    message:
      'Missing, unsupported or duplicated parameters, multiple credentials or malformed request.',
  },
  invalid_client: {
    status: 400,
    message: 'Client authorization failed.',
  },
  invalid_grant: {
    status: 400,
    message:
      'Invalid, expired or revoked authorization code, mismatched redirect URI or wrong client.',
  },
  unauthorized_client: {
    status: 400,
    message: 'The client is not authorized to use this grant type.',
  },
  unsupported_grant_type: {
    status: 400,
    message: 'The server does not support this grant type.',
  },
  invalid_scope: {
    status: 400,
    message: 'Requested scope is invalid or exceeds granted permissions.',
  },
} as const satisfies Readonly<
  Record<OAuthErrorCode, { status: number; message: string }>
>;

type HandleOpts = {
  context?: string;
  fallbackMessage?: string;
};

export function handleOlxAccessKeyErrors(
  errorCode: string,
  opts: HandleOpts = {},
): never {
  const code = (errorCode ?? '')
    .toString()
    .trim()
    .toLowerCase() as OAuthErrorCode;

  const mapped = (
    ERROR_MAP as Readonly<Record<string, { status: number; message: string }>>
  )[code];
  if (mapped) {
    throw new ErrorResponse(mapped.message, mapped.status);
  }

  const ctx = opts.context ? ` (${opts.context})` : '';
  const fallback =
    opts.fallbackMessage ??
    'Failed to obtain access key. Check credentials and configuration.';

  throw new ErrorResponse(`${fallback}${ctx} [code="${errorCode}"]`, 502);
}
