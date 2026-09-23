import { STATUS_CODES } from 'node:http';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { getRequestContext } from '../logging/request-context.middleware';

import { ERROR_CODES, STATUS_TO_ERROR_CODE, type ErrorCode } from './error-codes.const';

interface ValidationDetail {
  field: string;
  message: string;
}

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  errorCode: ErrorCode;
  path: string;
  requestId: string;
  details?: ValidationDetail[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidationErrorBody(body: unknown): body is { message: string[] } {
  return (
    isRecord(body) && Array.isArray(body.message) && body.message.every((m) => typeof m === 'string')
  );
}

// class-validator's default constraint messages are `${property} ${constraint
// description}` for stock decorators (e.g. "email must be an email"), so the
// leading token is a reasonable best-effort `field`. Custom per-constraint
// messages that don't follow this convention still produce a usable — if
// less precise — pair; the full original string is always kept as `message`
// so nothing is lost.
function toValidationDetails(messages: string[]): ValidationDetail[] {
  return messages.map((message) => {
    const [field] = message.split(' ');
    return { field: field || 'unknown', message };
  });
}

function extractErrorCode(body: unknown): ErrorCode | undefined {
  if (isRecord(body) && typeof body.errorCode === 'string') {
    return body.errorCode as ErrorCode;
  }
  return undefined;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string') return body;
  if (isRecord(body) && typeof body.message === 'string') return body.message;
  return fallback;
}

// Task 2.22 addition: lets a service/guard attach its own `details[]` to a
// thrown HttpException (e.g. CHILD_FIELD_NOT_EDITABLE naming the offending
// fields) and have it actually reach the client. Previously only the
// class-validator-shaped 400 branch above ever populated `details` — any
// other exception's own `details` was silently dropped.
function extractDetails(body: unknown): ValidationDetail[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.details)) {
    return undefined;
  }
  return body.details as ValidationDetail[];
}

function httpStatusPhrase(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      getRequestContext()?.requestId ??
      (typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : 'unknown');

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (status === HttpStatus.BAD_REQUEST && isValidationErrorBody(body)) {
        const payload: ErrorResponseBody = {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Validation failed',
          error: 'Bad Request',
          errorCode: ERROR_CODES.VALIDATION_ERROR,
          path: request.url,
          requestId,
          details: toValidationDetails(body.message),
        };
        response.status(HttpStatus.BAD_REQUEST).json(payload);
        return;
      }

      const errorCode = extractErrorCode(body) ?? STATUS_TO_ERROR_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;
      const details = extractDetails(body);

      const payload: ErrorResponseBody = {
        statusCode: status,
        message: extractMessage(body, exception.message),
        error: httpStatusPhrase(status),
        errorCode,
        path: request.url,
        requestId,
        ...(details ? { details } : {}),
      };
      response.status(status).json(payload);
      return;
    }

    // Body-parser (and other Express middleware) errors aren't HttpException
    // instances but do carry an HTTP status — e.g. malformed JSON throws a
    // SyntaxError with `.status = 400` before routing/ValidationPipe ever
    // run. Treat 4xx of these as the client error they are, not a 500.
    const rawStatus = isRecord(exception)
      ? (exception.status ?? exception.statusCode)
      : undefined;
    if (typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500) {
      const message = exception instanceof Error ? exception.message : 'Bad Request';
      const errorCode = STATUS_TO_ERROR_CODE[rawStatus] ?? ERROR_CODES.VALIDATION_ERROR;
      const payload: ErrorResponseBody = {
        statusCode: rawStatus,
        message: rawStatus === HttpStatus.BAD_REQUEST ? 'Validation failed' : message,
        error: httpStatusPhrase(rawStatus),
        errorCode,
        path: request.url,
        requestId,
        ...(rawStatus === HttpStatus.BAD_REQUEST
          ? { details: [{ field: 'body', message }] }
          : {}),
      };
      response.status(rawStatus).json(payload);
      return;
    }

    // Unhandled exception -> 500, no details, never leak the raw stack trace.
    const payload: ErrorResponseBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
      errorCode: ERROR_CODES.INTERNAL_ERROR,
      path: request.url,
      requestId,
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }
}
