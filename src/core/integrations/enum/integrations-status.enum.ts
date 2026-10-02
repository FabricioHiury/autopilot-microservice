export enum IntegrationsStatusEnum {
  OK = 'ok',
  ERROR = 'error',
  NOT_CONFIGURED = 'not_configured',
}

export enum IntegrationsStatusErrorMessageEnum {
  CHANNEL_UNAVAILABLE = 'Channel unavailable',
  INTEGRATION_NOT_CONFIGURED = 'Integration not configured',
  INVALID_TOKEN = 'Invalid token',
  ERROR_UNKNOWN = 'Unknown error',
}
