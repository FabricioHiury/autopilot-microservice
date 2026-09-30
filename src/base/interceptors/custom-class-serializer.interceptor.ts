import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { classToPlain } from 'class-transformer';
import { SKIP_SERIALIZER_KEY } from '../decorators/skip-serializer.decorator';

export interface ClassSerializerInterceptorOptions {
  strategy?: 'excludeAll' | 'exposeAll';
}

/**
 * When the decorator is present on a route handler, serialization is skipped.
 */
@Injectable()
export class CustomClassSerializerInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly options: ClassSerializerInterceptorOptions = {},
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skipSerializer = this.reflector.getAllAndOverride<boolean>(
      SKIP_SERIALIZER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipSerializer) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data === null || data === undefined) {
          return data;
        }
        return classToPlain(data, this.options);
      }),
    );
  }
}
