import { InstagramMessageOriginUtil } from './message-origin.util';
import { InstagramMessageOriginEnum } from '../enum/instagram-message-origin.enum';

describe('InstagramMessageOriginUtil', () => {
  describe('identifyMessageOrigin', () => {
    it('deve identificar resposta a story', () => {
      const message = {
        mid: 'test_mid',
        text: 'Resposta ao story',
        reply_to: {
          story: {
            url: 'https://instagram.com/story/123',
            id: 'story_123'
          }
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.STORY_REPLY);
      expect(result.storyId).toBe('story_123');
      expect(result.storyUrl).toBe('https://instagram.com/story/123');
      expect(result.postId).toBeUndefined();
      expect(result.reelId).toBeUndefined();
    });

    it('deve identificar resposta a post', () => {
      const message = {
        mid: 'test_mid',
        text: 'Resposta ao post',
        reply_to: {
          mid: 'post_mid_123'
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.POST_REPLY);
      expect(result.postId).toBe('post_mid_123');
      expect(result.storyId).toBeUndefined();
      expect(result.storyUrl).toBeUndefined();
    });

    it('deve identificar mensagem de referral', () => {
      const message = {
        mid: 'test_mid',
        text: 'Mensagem via referral',
        referral: {
          source: 'ADS',
          type: 'OPEN_THREAD',
          ref: 'campaign_123'
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.REFERRAL);
      expect(result.referralSource).toBe('ADS');
      expect(result.referralType).toBe('OPEN_THREAD');
      expect(result.referralRef).toBe('campaign_123');
    });

    it('deve identificar mensagem direta', () => {
      const message = {
        mid: 'test_mid',
        text: 'Mensagem direta'
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.DIRECT_MESSAGE);
      expect(result.storyId).toBeUndefined();
      expect(result.postId).toBeUndefined();
      expect(result.referralSource).toBeUndefined();
    });

    it('deve priorizar story reply sobre post reply quando ambos estão presentes', () => {
      const message = {
        mid: 'test_mid',
        text: 'Mensagem com ambos',
        reply_to: {
          mid: 'post_mid_123',
          story: {
            url: 'https://instagram.com/story/123',
            id: 'story_123'
          }
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.STORY_REPLY);
      expect(result.storyId).toBe('story_123');
    });
  });

  describe('getOriginDescription', () => {
    it('deve retornar descrição para story reply', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.STORY_REPLY,
        storyId: 'story_123',
        storyUrl: 'https://instagram.com/story/123'
      };

      const description = InstagramMessageOriginUtil.getOriginDescription(messageOrigin);

      expect(description).toBe('Resposta ao Story (ID: story_123)');
    });

    it('deve retornar descrição para post reply', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.POST_REPLY,
        postId: 'post_123'
      };

      const description = InstagramMessageOriginUtil.getOriginDescription(messageOrigin);

      expect(description).toBe('Resposta ao Post (ID: post_123)');
    });

    it('deve retornar descrição para referral', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.REFERRAL,
        referralSource: 'ADS',
        referralRef: 'campaign_123'
      };

      const description = InstagramMessageOriginUtil.getOriginDescription(messageOrigin);

      expect(description).toBe('Link de Referência (ADS) - Ref: campaign_123');
    });

    it('deve retornar descrição para mensagem direta', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.DIRECT_MESSAGE
      };

      const description = InstagramMessageOriginUtil.getOriginDescription(messageOrigin);

      expect(description).toBe('Mensagem Direta');
    });
  });

  describe('isContentReply', () => {
    it('deve retornar true para story reply', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.STORY_REPLY
      };

      const result = InstagramMessageOriginUtil.isContentReply(messageOrigin);

      expect(result).toBe(true);
    });

    it('deve retornar true para post reply', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.POST_REPLY
      };

      const result = InstagramMessageOriginUtil.isContentReply(messageOrigin);

      expect(result).toBe(true);
    });

    it('deve retornar false para referral', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.REFERRAL
      };

      const result = InstagramMessageOriginUtil.isContentReply(messageOrigin);

      expect(result).toBe(false);
    });

    it('deve retornar false para mensagem direta', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.DIRECT_MESSAGE
      };

      const result = InstagramMessageOriginUtil.isContentReply(messageOrigin);

      expect(result).toBe(false);
    });
  });

  describe('isFromReferral', () => {
    it('deve retornar true para referral', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.REFERRAL
      };

      const result = InstagramMessageOriginUtil.isFromReferral(messageOrigin);

      expect(result).toBe(true);
    });

    it('deve retornar false para outros tipos', () => {
      const messageOrigin = {
        origin: InstagramMessageOriginEnum.STORY_REPLY
      };

      const result = InstagramMessageOriginUtil.isFromReferral(messageOrigin);

      expect(result).toBe(false);
    });
  });

  describe('cenários complexos', () => {
    it('deve lidar com referral de produto', () => {
      const message = {
        mid: 'test_mid',
        text: 'Interesse no produto',
        referral: {
          product: {
            id: 'product_789'
          },
          source: 'SHORTLINK',
          type: 'OPEN_THREAD'
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      // Quando há product.id, a lógica atual classifica como POST_REPLY
      expect(result.origin).toBe(InstagramMessageOriginEnum.POST_REPLY);
      expect(result.referralSource).toBe('SHORTLINK');
      expect(result.postId).toBe('product_789');
    });

    it('deve lidar com quick reply', () => {
      const message = {
        mid: 'test_mid',
        text: 'Sim',
        quick_reply: {
          payload: 'YES_PAYLOAD'
        }
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.DIRECT_MESSAGE);
    });

    it('deve lidar com mensagem vazia', () => {
      const message = {
        mid: 'test_mid'
      };

      const result = InstagramMessageOriginUtil.identifyMessageOrigin(message);

      expect(result.origin).toBe(InstagramMessageOriginEnum.DIRECT_MESSAGE);
    });
  });
});