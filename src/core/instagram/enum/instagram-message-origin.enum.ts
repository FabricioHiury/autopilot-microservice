export enum InstagramMessageOriginEnum {
  DIRECT_MESSAGE = 'direct_message',
  STORY_REPLY = 'story_reply',
  POST_REPLY = 'post_reply',
  REEL_REPLY = 'reel_reply',
  REFERRAL = 'referral',
  UNKNOWN = 'unknown',
}

export interface InstagramMessageOriginDetails {
  origin: InstagramMessageOriginEnum;
  storyId?: string;
  storyUrl?: string;
  postId?: string;
  reelId?: string;
  referralSource?: string;
  referralRef?: string;
  referralType?: string;
}
