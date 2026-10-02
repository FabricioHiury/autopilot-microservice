import {
  InstagramMessageOriginEnum,
  InstagramMessageOriginDetails,
} from '../enum/instagram-message-origin.enum';

interface Message {
  mid: string;
  text?: string;
  is_deleted?: boolean;
  is_echo?: boolean;
  is_unsupported?: boolean;
  attachments?: any[];
  quick_reply?: {
    payload: string;
  };
  referral?: {
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
  };
  reply_to?: {
    mid?: string;
    story?: {
      url: string;
      id: string;
    };
  };
}

interface MediaUrlSource {
  url?: string;
  mediaId?: string;
  source: 'story' | 'referral_ad' | 'api_fetch' | 'none';
}

export class InstagramMessageOriginUtil {
  /**
   * Identifica a origem de uma text do Instagram
   */
  static identifyMessageOrigin(
    message: Message,
  ): InstagramMessageOriginDetails {
    if (message.reply_to?.story) {
      return {
        origin: InstagramMessageOriginEnum.STORY_REPLY,
        storyId: message.reply_to.story.id,
        storyUrl: message.reply_to.story.url,
      };
    }

    if (message.reply_to?.mid) {
      return {
        origin: InstagramMessageOriginEnum.POST_REPLY,
        postId: message.referral?.product?.id || message.reply_to.mid,
      };
    }

    if (message.referral) {
      const referral = message.referral;

      let origin = InstagramMessageOriginEnum.REFERRAL;

      if (referral.product?.id) {
        if (
          referral.source?.toLowerCase().includes('reel') ||
          referral.type?.toLowerCase().includes('reel')
        ) {
          origin = InstagramMessageOriginEnum.REEL_REPLY;
        } else {
          origin = InstagramMessageOriginEnum.POST_REPLY;
        }
      }

      return {
        origin,
        referralSource: referral.source,
        referralRef: referral.ref,
        referralType: referral.type,
        postId: referral.product?.id,
        reelId:
          referral.product?.id &&
          origin === InstagramMessageOriginEnum.REEL_REPLY
            ? referral.product.id
            : undefined,
      };
    }

    if (message.attachments?.length > 0) {
      const firstAttachment = message.attachments[0];
      const attachmentType = firstAttachment?.type?.toLowerCase();

      if (
        attachmentType === 'story_mention' ||
        attachmentType === 'story_reply'
      ) {
        return {
          origin: InstagramMessageOriginEnum.STORY_REPLY,
        };
      }

      if (attachmentType === 'ig_reel' || attachmentType === 'reel') {
        return {
          origin: InstagramMessageOriginEnum.REEL_REPLY,
        };
      }

      if (attachmentType === 'share' && firstAttachment?.payload?.url) {
        const url = firstAttachment.payload.url.toLowerCase();
        if (url.includes('/reel/') || url.includes('reels')) {
          return {
            origin: InstagramMessageOriginEnum.REEL_REPLY,
          };
        } else if (url.includes('/p/') || url.includes('posts')) {
          return {
            origin: InstagramMessageOriginEnum.POST_REPLY,
          };
        }
      }
    }

    // 5. Mensagem direta normal
    return {
      origin: InstagramMessageOriginEnum.DIRECT_MESSAGE,
    };
  }

  static getOriginDescription(
    originDetails: InstagramMessageOriginDetails,
  ): string {
    switch (originDetails.origin) {
      case InstagramMessageOriginEnum.STORY_REPLY:
        return `Story reply${originDetails.storyId ? ` (ID: ${originDetails.storyId})` : ''}`;

      case InstagramMessageOriginEnum.POST_REPLY:
        return `Post reply${originDetails.postId ? ` (ID: ${originDetails.postId})` : ''}`;

      case InstagramMessageOriginEnum.REEL_REPLY:
        return `Reel reply${originDetails.reelId ? ` (ID: ${originDetails.reelId})` : ''}`;

      case InstagramMessageOriginEnum.REFERRAL:
        let desc = 'Referral link';
        if (originDetails.referralSource) {
          desc += ` (${originDetails.referralSource})`;
        }
        if (originDetails.referralRef) {
          desc += ` - Ref: ${originDetails.referralRef}`;
        }
        return desc;

      case InstagramMessageOriginEnum.DIRECT_MESSAGE:
        return 'Direct message';

      default:
        return 'Unknown origin';
    }
  }

  static isContentReply(originDetails: InstagramMessageOriginDetails): boolean {
    return [
      InstagramMessageOriginEnum.STORY_REPLY,
      InstagramMessageOriginEnum.POST_REPLY,
      InstagramMessageOriginEnum.REEL_REPLY,
    ].includes(originDetails.origin);
  }

  /**
   * Verifica se a text veio de um referral/link
   */
  static isFromReferral(originDetails: InstagramMessageOriginDetails): boolean {
    return originDetails.origin === InstagramMessageOriginEnum.REFERRAL;
  }

  static extractMediaSource(
    message: Message,
    originDetails: InstagramMessageOriginDetails,
  ): MediaUrlSource {
    if (originDetails.origin === InstagramMessageOriginEnum.STORY_REPLY) {
      if (originDetails.storyUrl) {
        return { url: originDetails.storyUrl, source: 'story' };
      }

      return { source: 'none' };
    }

    // 2. Referral: verificar se tem URL direta de ads
    if (
      originDetails.origin === InstagramMessageOriginEnum.REFERRAL &&
      message.referral?.ads_context_data
    ) {
      const adsMedia =
        message.referral.ads_context_data.photo_url ||
        message.referral.ads_context_data.video_url;
      if (adsMedia) {
        return { url: adsMedia, source: 'referral_ad' };
      }
    }

    // 3. Post/Reel/Referral com product: buscar via API
    const mediaId = originDetails.postId || originDetails.reelId;
    if (mediaId) {
      return { mediaId, source: 'api_fetch' };
    }

    return { source: 'none' };
  }
}
