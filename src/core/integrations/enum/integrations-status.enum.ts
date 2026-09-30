export enum IntegrationsStatusEnum {
  OK = 'ok',
  ERROR = 'erro',
  NOT_CONFIGURED = 'nao_configurado',
}

export enum IntegrationsStatusErrorMessageEnum {
  CHANNEL_UNAVAILABLE = 'Canal indisponível',
  INTEGRATION_NOT_CONFIGURED = 'Integração não configurada',
  INVALID_TOKEN = 'Token inválido',
  ERROR_UNKNOWN = 'Erro desconhecido',
}
