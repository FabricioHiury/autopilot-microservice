import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor() { }

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    const apiToken = request.headers["x-micro-token"] as string;

    if (apiToken && apiToken === process.env.API_KEY) {
      return true;
    } else {
      throw new ErrorResponse("Unauthorized", 401);
    }
  }
}
