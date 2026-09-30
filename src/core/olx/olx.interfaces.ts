export interface IOlxAccessKey {
  access_token: string;
  token_type: string;
}

export interface IOlxIncomingMessageDto {
  chatId: string;
  message: string;
  senderType: 'account' | 'system';
  email: string;
  name: string;
  phone: string;
  messageTimestamp: Date;
  messageId: string;
  origin: 'buyer' | 'seller';
  listId: string;
}

export interface IOlxOutgoingMessageDto {
  textMessage: string;
  messageId?: string;
  chatId: string;
}
