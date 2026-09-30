import { ErrorResponse } from 'src/base/exceptions/error.response.handler';

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
      'Falta de parâmetro obrigatório na requisição, incluiu um parâmetro não suportado/repetido, múltiplas credenciais ou malformação da requisição.',
  },
  invalid_client: {
    status: 400,
    message: 'Falha na autorização do cliente.',
  },
  invalid_grant: {
    status: 400,
    message:
      'Código de autorização inválido, expirado ou revogado; URI diferente da usada na autorização; ou emitido para outro cliente.',
  },
  unauthorized_client: {
    status: 400,
    message:
      'O cliente autenticado não está autorizado a utilizar este tipo de autorização (grant_type).',
  },
  unsupported_grant_type: {
    status: 400,
    message: 'O tipo de autorização (grant_type) não é suportado pelo servidor.',
  },
  invalid_scope: {
    status: 400,
    message:
      'A solicitação de escopo é inválida, desconhecida ou excede as permissões concedidas pelo usuário.',
  },
} as const satisfies Readonly<Record<OAuthErrorCode, { status: number; message: string }>>;

type HandleOpts = {
  context?: string;
  fallbackMessage?: string;
};

export function handleOlxAccessKeyErrors(errorCode: string, opts: HandleOpts = {}): never {
  const code = (errorCode ?? '').toString().trim().toLowerCase() as OAuthErrorCode;

  const mapped = (ERROR_MAP as Readonly<Record<string, { status: number; message: string }>>)[code];
  if (mapped) {
    throw new ErrorResponse(mapped.message, mapped.status);
  }

  const ctx = opts.context ? ` (${opts.context})` : '';
  const fallback =
    opts.fallbackMessage ??
    'Erro ao obter chave de acesso. Tente novamente ou verifique as credenciais/configuração.';

  throw new ErrorResponse(`${fallback}${ctx} [code="${errorCode}"]`, 502);
}
