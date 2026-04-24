import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import * as winston from "winston";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  /**
   * Pillar 5 — Observability: Structured JSON logging via Winston.
   *
   * Every log line is a JSON object with timestamp, level, context, traceId, etc.
   * This makes logs machine-parseable by tools like Datadog, Splunk, or CloudWatch
   * Insights — no more grepping through freeform text.
   */
  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
          winston.format.ms(),
          // In development: pretty coloured output
          // In production: switch to `winston.format.json()` for log aggregators
          winston.format.colorize({ all: true }),
          winston.format.printf(
            ({ timestamp, level, message, context, ms, ...meta }) => {
              const metaPart =
                Object.keys(meta).length > 0
                  ? `\n  ${JSON.stringify(meta)}`
                  : "";
              return `${timestamp} ${ms} ${level} [${context ?? "App"}]: ${message}${metaPart}`;
            },
          ),
        ),
      }),
    ],
  });

  const app = await NestFactory.create(AppModule, { logger });

  /**
   * Pillar 6 — Versioning: URI-based versioning.
   *
   * All routes are prefixed with /v<n>/.  The controller declares @Version('1'),
   * making the endpoint available at POST /v1/order.
   * Future breaking changes ship as /v2/order — existing clients are unaffected.
   */
  app.enableVersioning({ type: VersioningType.URI });

  /**
   * ValidationPipe: strips unknown fields and validates the request body
   * against the DTO using class-validator decorators.
   * ValidationPipe errors are caught by HttpExceptionFilter and returned
   * in the standardized error format.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * Pillar 4 — Error Standardization: global exception filter.
   *
   * Every thrown exception — 400, 429, 500, unhandled — is caught here
   * and serialised into the same { statusCode, code, message, traceId, ... } shape.
   */
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`\n🚀  Order Service is running`);
  console.log(`   POST http://localhost:${port}/v1/order`);
  console.log(`\n   Required header: Idempotency-Key: <uuid>`);
  console.log(`   Rate limit:       5 requests / 60s (per IP)\n`);
}

bootstrap();
