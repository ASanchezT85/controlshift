import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { MAX_ARTIFACT_BYTES } from './artifacts';
import { scannerConfig } from './scanner';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.register(multipart as any, { limits: { fileSize: MAX_ARTIFACT_BYTES, files: 1 } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3100',
    // PATCH and DELETE are not in the default allow-list, and a preflight that
    // omits them fails only in a browser.
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
  console.log(`controlshift api on http://127.0.0.1:${port}/api`);

  // An operator should never have to discover this from a refused analysis.
  const scanner = scannerConfig();
  if (scanner.host) {
    console.log(`malware scanning via clamd at ${scanner.host}:${scanner.port}`);
  } else if (process.env.ALLOW_UNSCANNED_ARTIFACTS === 'true') {
    console.warn(
      'WARNING: no malware scanner configured and ALLOW_UNSCANNED_ARTIFACTS=true. ' +
        'Uploads are accepted unscanned. Development only.',
    );
  } else {
    console.warn(
      'no malware scanner configured (CLAMD_HOST unset): uploads will be stored ' +
        'as RECEIVED and analysis will refuse them',
    );
  }
}

bootstrap();
