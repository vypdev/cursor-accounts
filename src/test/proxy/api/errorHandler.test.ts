import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  apiErrorHandler,
  PUBLIC_API_ERROR_MESSAGE,
} from '../../../proxy/api/middleware/errorHandler';

describe('apiErrorHandler', () => {
  it('does not expose attacker-controlled or sensitive error details', () => {
    let statusCode = 200;
    let body: unknown;
    let nextCalled = false;
    const response = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return response;
      },
      json(value: unknown) {
        body = value;
        return response;
      },
    } as unknown as Response;

    apiErrorHandler(
      new Error('/private/token=super-secret parser payload'),
      {} as Request,
      response,
      (() => {
        nextCalled = true;
      }) as NextFunction
    );

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 500);
    assert.deepEqual(body, { error: PUBLIC_API_ERROR_MESSAGE });
    assert.equal(JSON.stringify(body).includes('super-secret'), false);
  });
});
