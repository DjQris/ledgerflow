import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

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
    const request = context.getRequest<unknown>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

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

    const requestUrl: unknown = httpAdapter.getRequestUrl(request);
    const requestMethod: unknown = httpAdapter.getRequestMethod(request);

    const responseBody: ApiErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: typeof requestUrl === 'string' ? requestUrl : '',
      method: typeof requestMethod === 'string' ? requestMethod : '',
      message,
      error,
    };

    httpAdapter.reply(context.getResponse(), responseBody, status);
  }
}
