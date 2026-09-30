import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable()
export class AppInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const url = request.url;

    if (url.startsWith('/instagram/webhooks') || url.startsWith('/facebook/webhooks') || url.startsWith('/webhook/whatsapp-official')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        return {
          message: 'Operação realizada com sucesso.',
          statusCode: context.switchToHttp().getResponse().statusCode,
          data: data,
        };
      }),
      catchError((err) => {
        return throwError(() => err);
      }),
    );
  }
}
