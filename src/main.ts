import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  Logger,
  ValidationPipe,
  VersioningType,
  NestApplicationOptions,
} from '@nestjs/common';
import { CustomClassSerializerInterceptor } from './base/interceptors/custom-class-serializer.interceptor';
import { ErrorFilter } from './base/exceptions/error.response.filter';
import { AppInterceptor } from './app.interceptor';
import { CSS_DOCS } from './docs.constants';
import { apiReference } from '@scalar/nestjs-api-reference';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { readFileSync, existsSync } from 'fs';
import { AddressInfo } from 'net';

export default class Server {
  private app!: NestExpressApplication;
  private server!: any;
  private port: number;
  private host: string;

  constructor() {
    this.port = Number(process.env.PORT) || 3005;
    this.host = process.env.HOST || '0.0.0.0';
  }

  static configureProcessHandlers(): void {
    process.on('unhandledRejection', (reason) => {
      Logger.error('Unhandled rejection', reason);
    });
  }

  static configureApp(app: NestExpressApplication): void {
    const bodyLimit = process.env.BODY_LIMIT || '10mb';
    app.use(
      json({
        limit: bodyLimit,
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.use(
      urlencoded({
        limit: bodyLimit,
        extended: true,
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );

    app.set('trust proxy', '1');
    (app as any).disable?.('x-powered-by');

    const apiPrefix = process.env.API_PREFIX || '';
    if (apiPrefix) app.setGlobalPrefix(apiPrefix.replace(/^\/+|\/+$/g, ''));
    app.enableVersioning({ type: VersioningType.URI });

    const enableDocs =
      (process.env.ENABLE_DOCS || 'true').toLowerCase() !== 'false';

    if (enableDocs) {
      const config = new DocumentBuilder()
        .setTitle('API')
        .setDescription('API documentation')
        .setVersion(process.env.npm_package_version || '0.0.0')
        .addApiKey(
          { type: 'apiKey', name: 'x-micro-token', in: 'header' },
          'api-key',
        )
        .addBearerAuth()
        .build();

      const document = SwaggerModule.createDocument(app, config);
      const docsPath = process.env.DOCS_PATH || '/docs';

      app.use(
        docsPath,
        apiReference({
          theme: 'purple',
          darkMode: false,
          hideModels: true,
          hideDownloadButton: true,
          spec: { content: document },
          customCss: CSS_DOCS,
        }),
      );
    }

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    app.useGlobalInterceptors(
      new CustomClassSerializerInterceptor(app.get(Reflector), {
        strategy: 'exposeAll',
      }),
    );

    app.useGlobalInterceptors(new AppInterceptor());
    app.useGlobalFilters(new ErrorFilter());

    const corsOrigin = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : true;

    app.enableCors({
      origin: corsOrigin,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      allowedHeaders:
        'Content-Type, Accept, Authorization, x-micro-token, x-api-key',
      credentials: true,
    });

    app.enableShutdownHooks();

    const server = app.getHttpServer();
    const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const keepAliveTimeoutMs = Number(
      process.env.KEEP_ALIVE_TIMEOUT_MS || 5000,
    );
    const headersTimeoutMs = Number(process.env.HEADERS_TIMEOUT_MS || 60000);

    server.setTimeout?.(requestTimeoutMs);
    server.keepAliveTimeout = keepAliveTimeoutMs;
    server.headersTimeout = headersTimeoutMs;
  }

  static getNestOptions(): NestApplicationOptions {
    const httpsEnabled =
      (process.env.HTTPS || 'false').toLowerCase() === 'true';
    const options: NestApplicationOptions = { rawBody: true };
    if (httpsEnabled) {
      const keyPath = process.env.SSL_KEY_PATH || '';
      const certPath = process.env.SSL_CERT_PATH || '';
      if (existsSync(keyPath) && existsSync(certPath)) {
        options.httpsOptions = {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath),
        };
      } else {
        Logger.warn(
          'HTTPS requested but SSL_KEY_PATH/SSL_CERT_PATH not found. Falling back to HTTP.',
        );
      }
    }
    return options;
  }

  async init(): Promise<void> {
    Server.configureProcessHandlers();
    if (!process.env.MICROSERVICE_TOKEN)
      throw new Error('MICROSERVICE_TOKEN is required');
    if (!process.env.AUTOPILOT_URL)
      throw new Error('AUTOPILOT_URL is required');
    this.app = await NestFactory.create<NestExpressApplication>(
      AppModule,
      Server.getNestOptions(),
    );
    Server.configureApp(this.app);

    this.server = this.app.getHttpServer();
    await this.app.listen(this.port, this.host);
    const url = await this.app.getUrl();
    Logger.log(`Application is running at ${url}`);
    const address = this.server.address() as AddressInfo | null;
    if (address) {
      Logger.log(`Server listening on ${address.address}:${address.port}`);
    }
    if ((process.env.ENABLE_DOCS || 'true').toLowerCase() !== 'false') {
      const docsPath = process.env.DOCS_PATH || '/docs';
      Logger.log(`API docs available at ${url}${docsPath}`);
    }
  }
}

const server = new Server();
if (require.main === module) {
  server.init().catch((error) => {
    Logger.error('Startup failed', error.stack);
    process.exitCode = 1;
  });
}
