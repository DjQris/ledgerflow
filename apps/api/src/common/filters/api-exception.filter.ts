import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';
import { sanitizedPath } from '../http-security';

interface ApiErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();

    const tooLarge =
      isRecord(exception) && exception.type === 'entity.too.large';
    const parseFailure =
      isRecord(exception) && exception.type === 'entity.parse.failed';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : tooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : parseFailure
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (tooLarge) {
      message = 'Request body too large';
      error = 'Payload Too Large';
    } else if (parseFailure) {
      message = 'Invalid JSON body';
      error = 'Bad Request';
    }

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (isRecord(exceptionResponse)) {
        const responseMessage = exceptionResponse.message;
        if (
          typeof responseMessage === 'string' ||
          isStringArray(responseMessage)
        ) {
          message = responseMessage;
        }

        if (typeof exceptionResponse.error === 'string') {
          error = exceptionResponse.error;
        }
      }
    }

    const requestMethod: unknown = httpAdapter.getRequestMethod(request);

    const responseBody: ApiErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: sanitizedPath(request),
      method: typeof requestMethod === 'string' ? requestMethod : '',
      message,
      error,
    };

    httpAdapter.reply(context.getResponse(), responseBody, status);
  }
}
