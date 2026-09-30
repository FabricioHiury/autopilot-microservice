import { SetMetadata } from '@nestjs/common';

export const SKIP_SERIALIZER_KEY = 'skipSerializer';

/**
 * Decorator to skip the ClassSerializerInterceptor for a specific route.
 */
export const SkipSerializer = () => SetMetadata(SKIP_SERIALIZER_KEY, true);
