import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
} from '@prisma/client/runtime/library';

type ErrorBody = Readonly<{
  message: string;
  statusCode: number;
  data: null;
}>;


function safeStringify(input: unknown, fallback = 'Erro interno do servidor.'): string {
  try {
    if (typeof input === 'string') return input;
    if (input == null) return fallback;

    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const msg = obj.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
      if (typeof obj.error === 'string') return obj.error;
    }
    return JSON.stringify(input);
  } catch {
    return fallback;
  }
}

function mapPrismaError(err: PrismaClientKnownRequestError): { status: number; message: string } {
  const { code, meta } = err;

  const model = typeof meta?.modelName === 'string' ? meta.modelName : undefined;
  const target = Array.isArray(meta?.target) ? meta?.target.join(', ') : (meta?.target as string | undefined);

  switch (code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        message: `Conflito de dados${model ? ` (${model})` : ''}${target ? ` em ${target}` : ''}.`,
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Violação de chave estrangeira${model ? ` (${model})` : ''}.`,
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: `Registro não encontrado${model ? ` (${model})` : ''}.`,
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Erro de banco de dados.',
      };
  }
}

@Catch(Error)
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    if (res.headersSent) {
      this.logger.warn('Resposta já enviada pelo Express. O filtro de exceção não irá escrever novamente.');
      return;
    }

    const { status, message } = this.resolveStatusAndMessage(exception);

    const method = req?.method ?? 'UNKNOWN';
    const url = req?.url ?? '';
    const name = (exception as any)?.constructor?.name ?? 'Error';

    if (status >= 500) {
      this.logger.error(`(${name}) ${status} ${method} ${url} - ${message}`);
      const stack = (exception as any)?.stack;
      if (typeof stack === 'string') this.logger.error(stack);
    } else {
      this.logger.warn(`${status} ${method} ${url} - ${message}`);
    }

    const body: ErrorBody = { message, statusCode: status, data: null };
    res.status(status).json(body);
  }

  private resolveStatusAndMessage(exception: unknown): { status: number; message: string } {
    const defaultStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    const defaultMessage = 'Erro interno do servidor.';


    
    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        message: safeStringify(exception.getResponse(), defaultMessage),
      };
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      return mapPrismaError(exception);
    }

    if (exception instanceof PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Falha ao inicializar o cliente do banco de dados.',
      };
    }

    if (exception instanceof PrismaClientRustPanicError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Erro interno do cliente do banco de dados.',
      };
    }

    const msg = (exception as any)?.message as string | undefined;
    if (typeof msg === 'string' && msg.includes('Transaction failed')) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Falha na transação do banco de dados.',
      };
    }

    return {
      status: defaultStatus,
      message: safeStringify((exception as any)?.message ?? exception, defaultMessage),
    };
  }
}