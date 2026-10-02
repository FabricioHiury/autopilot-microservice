export interface FacebookGetTokenDto {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  code: string;
}

export interface FacebookGetTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface FacebookUserResponse {
  id: string;
  name?: string;
}

export interface FacebookDeleteDataPayload {
  algorithm: string;
  expires: number;
  issued_at: number;
  user_id: string;
}

export interface FacebookUserDataResponse {
  id?: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface PageData {
  access_token: string;
  category: string;
  category_list: Category[];
  name: string;
  id: string;
  tasks: string[];
}

interface PagingCursors {
  before: string;
  after: string;
}

interface Paging {
  cursors: PagingCursors;
}

export interface FacebookPageResponse {
  data: PageData[];
  paging: Paging;
}

export interface FacebookDelivery {
  mids?: string[];
  watermark: number;
  seq: number;
}

export interface FacebookRead {
  watermark: number;
  seq: number;
}

export interface FacebookPostback {
  payload: string;
  title?: string;
  referral?: any;
  timestamp?: number;
}

export interface FacebookOptin {
  ref?: string;
  user_ref?: string;
}

// Mensagens

export interface FacebookPayload {
  object: string;
  entry: Entry[];
}

interface Entry {
  id: string;
  time: number;
  messaging: Messaging[];
}

interface Messaging {
  sender: {
    id: string;
  };
  recipient: {
    id: string;
  };
  timestamp: number;
  message: Message;
  delivery?: FacebookDelivery;
  read?: FacebookRead;
  postback?: FacebookPostback;
  optin?: FacebookOptin;
}

interface Message {
  mid: string;
  text?: string;
  attachments?: Attachment[];
  quick_reply?: { payload: string };
  is_echo?: boolean;
}

interface Attachment {
  type: string;
  payload: {
    url: string;
  };
}
