export interface InstagramObterShortLivedTokenDto {
  client_id: string;
  client_secret: string;
  grant_type: 'authorization_code';
  redirect_uri: string;
  code: string;
}

export interface InstagramShortLivedTokenResponse {
  access_token: string;
  user_id: number;
  permissions: string;
}

export interface InstagramGetLongLivedTokenDto {
  access_token: string;
  client_secret: string;
  grant_type: 'ig_exchange_token';
}

export interface InstagramLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface InstagramRefreshLongLivedTokenDto {
  access_token: string;
  grant_type: 'ig_refresh_token';
}

export interface InstagramUserResponse {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: 'Business' | 'Media_Creator';
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface InstagramDeleteDataPayload {
  algorithm: string;
  expires: number;
  issued_at: number;
  user_id: string;
}

export interface InstagramUserDataResponse {
  name?: string;
  username?: string;
  profile_pic?: string;
  profile_picture_url?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

// Mensagem

export interface InstagramPayload {
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
}

interface Message {
  mid: string;
  text?: string;
  is_deleted?: boolean;
  is_echo?: boolean;
  is_unsupported?: boolean;
  attachments?: Attachment[];
  quick_reply?: {
    payload: string;
  };
  referral?: Referral;
  reply_to?: InlineReply | StoryReply;
}

interface Attachment {
  type: string;
  payload: {
    url: string;
  };
}

interface Referral {
  product?: {
    id: string;
  };
  ref?: string;
  ad_id?: string;
  source?: string;
  type?: string;
  ads_context_data?: {
    ad_title?: string;
    photo_url?: string;
    video_url?: string;
  };
}

interface InlineReply {
  mid: string;
}

interface StoryReply {
  story: {
    url: string;
    id: string;
  };
}
