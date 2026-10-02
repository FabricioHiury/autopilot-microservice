import { HttpException } from '@nestjs/common';

export class ErrorResponse extends HttpException {
  constructor(
    message: string,
    status: number = 500,
    _errors: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}
