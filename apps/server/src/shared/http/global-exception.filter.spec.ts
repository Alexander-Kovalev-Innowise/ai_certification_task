import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { ERROR_CODES } from './error-codes.const';
import { GlobalExceptionFilter } from './global-exception.filter';

interface CapturedResponseBody {
  statusCode: number;
  message: string;
  error: string;
  errorCode: string;
  path: string;
  requestId: string;
  details?: { field: string; message: string }[];
}

function createHost(url = '/test'): {
  host: ArgumentsHost;
  getBody: () => CapturedResponseBody;
  getStatus: () => number;
} {
  let statusCode = 0;
  let jsonBody: CapturedResponseBody | undefined;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: CapturedResponseBody) {
      jsonBody = body;
      return this;
    },
  };

  const request = { url, headers: {} };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    getBody: () => jsonBody as CapturedResponseBody,
    getStatus: () => statusCode,
  };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('maps a class-validator style BadRequestException to 400 VALIDATION_ERROR with details[]', () => {
    const { host, getBody, getStatus } = createHost('/player-profiles');
    const exception = new BadRequestException([
      'email must be an email',
      'dateOfBirth must be a valid ISO 8601 date string',
    ]);

    filter.catch(exception, host);

    expect(getStatus()).toBe(400);
    const body = getBody();
    expect(body.errorCode).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.details).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'dateOfBirth', message: 'dateOfBirth must be a valid ISO 8601 date string' },
    ]);
    expect(body.path).toBe('/player-profiles');
  });

  it('maps a generic HttpException to its catalog errorCode', () => {
    const { host, getBody, getStatus } = createHost('/admin/users/123');
    const exception = new ForbiddenException('Nope');

    filter.catch(exception, host);

    expect(getStatus()).toBe(403);
    const body = getBody();
    expect(body.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.details).toBeUndefined();
  });

  it('respects an explicit errorCode carried on the exception response body', () => {
    const { host, getBody, getStatus } = createHost('/auth/me');
    const exception = new UnauthorizedException({
      errorCode: 'ACCOUNT_INACTIVE',
      message: 'Account is inactive',
    });

    filter.catch(exception, host);

    expect(getStatus()).toBe(401);
    const body = getBody();
    expect(body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  // Task 2.22 regression: PATCH /me's CHILD_FIELD_NOT_EDITABLE needs its
  // own `details[]` (naming the offending fields) to actually reach the
  // client — previously only the class-validator-shaped 400 branch above
  // ever populated `details`, silently dropping it for every other
  // exception.
  it('passes through details[] attached to a non-validation exception body', () => {
    const { host, getBody, getStatus } = createHost('/me');
    const exception = new ForbiddenException({
      message: 'Not editable',
      errorCode: 'CHILD_FIELD_NOT_EDITABLE',
      details: [{ field: 'firstName', message: 'firstName is not editable by a child login' }],
    });

    filter.catch(exception, host);

    expect(getStatus()).toBe(403);
    const body = getBody();
    expect(body.errorCode).toBe('CHILD_FIELD_NOT_EDITABLE');
    expect(body.details).toEqual([{ field: 'firstName', message: 'firstName is not editable by a child login' }]);
  });

  it('maps an unhandled Error to 500 INTERNAL_ERROR with no details', () => {
    const { host, getBody, getStatus } = createHost('/boom');
    const exception = new Error('unexpected failure');

    filter.catch(exception, host);

    expect(getStatus()).toBe(500);
    const body = getBody();
    expect(body.errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(body.details).toBeUndefined();
  });
});
