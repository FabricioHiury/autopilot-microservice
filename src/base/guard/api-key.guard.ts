import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { matchesSecret } from '../../core/delivery/delivery.utils';
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token =
      request.headers['x-micro-token'] || request.headers['x-api-key'];
    if (!matchesSecret(token, process.env.MICROSERVICE_TOKEN))
      throw new UnauthorizedException('Unauthorized');
    return true;
  }
}
