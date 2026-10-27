import 'server-only';

import { backendRequest, currentSession } from '@/lib/auth/backend';
import { isCanonicalPositiveMinor } from './transfer-money';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;
const MAX_MINOR_UNITS = 9_223_372_036_854_775_807n;

type FailureOutcome = 'failed' | 'unknown';

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function fail(
  status: number,
  code: string,
  message: string,
  outcome: FailureOutcome = 'failed',
): Response {
  return json({ status, code, outcome, message }, status);
}

function sameOrigin(request: Request): boolean {
  return (
    request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}

class BodyTooLargeError extends Error {}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength))
      throw new SyntaxError('Invalid content length');
    if (Number(declaredLength) > MAX_BODY_BYTES) throw new BodyTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as unknown;
}

function validatedCommand(value: unknown): {
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        !['sourceWalletId', 'destinationWalletId', 'amountMinor'].includes(key),
    )
  )
    return null;
  if (
    typeof input.sourceWalletId !== 'string' ||
    !uuidV4.test(input.sourceWalletId) ||
    typeof input.destinationWalletId !== 'string' ||
    !uuidV4.test(input.destinationWalletId) ||
    typeof input.amountMinor !== 'string' ||
    !isCanonicalPositiveMinor(input.amountMinor) ||
    input.sourceWalletId.toLowerCase() ===
      input.destinationWalletId.toLowerCase()
  )
    return null;
  return {
    amountMinor: input.amountMinor,
    destinationWalletId: input.destinationWalletId.toLowerCase(),
    sourceWalletId: input.sourceWalletId.toLowerCase(),
  };
}

function isTransferResult(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.transferId === 'string' &&
    uuidV4.test(result.transferId) &&
    typeof result.journalId === 'string' &&
    uuidV4.test(result.journalId) &&
    result.status === 'COMPLETED' &&
    typeof result.sourceWalletId === 'string' &&
    uuidV4.test(result.sourceWalletId) &&
    typeof result.destinationWalletId === 'string' &&
    uuidV4.test(result.destinationWalletId) &&
    typeof result.amountMinor === 'string' &&
    isCanonicalPositiveMinor(result.amountMinor) &&
    typeof result.sourceBalanceMinor === 'string' &&
    isCanonicalBalance(result.sourceBalanceMinor) &&
    typeof result.destinationBalanceMinor === 'string' &&
    isCanonicalBalance(result.destinationBalanceMinor) &&
    typeof result.completedAt === 'string' &&
    Number.isFinite(Date.parse(result.completedAt))
  );
}

function isCanonicalBalance(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_MINOR_UNITS;
  } catch {
    return false;
  }
}

async function csrfToken(): Promise<{
  token: string | null;
  response?: Response;
}> {
  const response = await backendRequest('auth/csrf');
  if (!response.ok) return { token: null, response };
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === 'object' &&
      'csrfToken' in body &&
      typeof body.csrfToken === 'string' &&
      /^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/.test(body.csrfToken)
    ) {
      return { token: body.csrfToken };
    }
  } catch {
    // Normalize malformed internal responses without returning token data.
  }
  return { token: null };
}

function safeApiFailure(status: number, body: unknown): Response {
  const rawMessage =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message: unknown }).message
      : null;
  const messages = Array.isArray(rawMessage)
    ? rawMessage.filter(
        (message): message is string => typeof message === 'string',
      )
    : typeof rawMessage === 'string'
      ? [rawMessage]
      : [];
  const detail = messages.join(' ').toLowerCase();

  if (detail.includes('insufficient funds')) {
    return fail(
      409,
      'INSUFFICIENT_FUNDS',
      'The selected wallet does not have enough available funds.',
    );
  }
  if (detail.includes('source and destination wallets must be different')) {
    return fail(
      400,
      'SELF_TRANSFER',
      'Choose a recipient wallet different from the source wallet.',
    );
  }
  if (detail.includes('not active') || detail.includes('unavailable')) {
    return fail(
      409,
      'WALLET_UNAVAILABLE',
      'One of the wallets is not active and cannot be used.',
    );
  }
  if (detail.includes('not found')) {
    return fail(
      404,
      'WALLET_NOT_FOUND',
      'The source or recipient wallet could not be found.',
    );
  }
  if (
    detail.includes('conflicted with another database transaction') ||
    detail.includes('retry it')
  ) {
    return fail(
      409,
      'TRANSFER_CONFLICT',
      'The outcome is not confirmed. Retry safely to check this same transfer.',
      'unknown',
    );
  }
  if (detail.includes('idempotency') && detail.includes('payload')) {
    return fail(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This request does not match the saved transfer intent. Do not submit a new transfer.',
      'unknown',
    );
  }
  if ([500, 502, 503].includes(status)) {
    return fail(
      status,
      'TRANSFER_OUTCOME_UNKNOWN',
      'We could not confirm whether the transfer completed. Verify this same transfer before trying anything else.',
      'unknown',
    );
  }
  const safeStatus = [400, 401, 403, 404, 409, 413, 429].includes(status)
    ? status
    : 502;
  const safeMessages: Record<number, string> = {
    400: 'The transfer details were rejected. Review the wallet IDs and amount.',
    401: 'Your session has expired. Sign in before retrying this transfer.',
    403: 'This transfer is not permitted for your account.',
    404: 'The source or recipient wallet could not be found.',
    409: 'The transfer was rejected because of a wallet conflict.',
    413: 'The transfer request is too large.',
    429: 'Too many transfer attempts. Wait before trying again.',
    502: 'The transfer service returned an unexpected response.',
  };
  return fail(
    safeStatus,
    safeStatus === 401 ? 'SESSION_EXPIRED' : 'TRANSFER_REJECTED',
    safeMessages[safeStatus],
  );
}

export async function handleCustomerTransfer(
  request: Request,
): Promise<Response> {
  if (!sameOrigin(request))
    return fail(403, 'ORIGIN_REJECTED', 'This request is not permitted.');
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type') ?? '',
    )
  ) {
    return fail(400, 'INVALID_REQUEST', 'The transfer request is invalid.');
  }

  let command: ReturnType<typeof validatedCommand>;
  try {
    command = validatedCommand(await readJsonBody(request));
  } catch (error) {
    return fail(
      error instanceof BodyTooLargeError ? 413 : 400,
      'INVALID_REQUEST',
      'The transfer request is invalid.',
    );
  }
  if (!command)
    return fail(
      400,
      'INVALID_TRANSFER',
      'Enter two different valid wallet IDs and a positive amount.',
    );

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || !uuidV4.test(idempotencyKey)) {
    return fail(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'A valid transfer request key is required.',
    );
  }

  try {
    const session = await currentSession();
    if (!session.profile) {
      const status = [401, 403, 503].includes(session.status)
        ? session.status
        : 503;
      return fail(
        status,
        status === 401 ? 'SESSION_EXPIRED' : 'SESSION_UNAVAILABLE',
        status === 401
          ? 'Your session has expired. Sign in before retrying this transfer.'
          : 'Your account could not be verified. No transfer was submitted.',
      );
    }
    if (session.profile.role !== 'CUSTOMER')
      return fail(
        403,
        'TRANSFER_FORBIDDEN',
        'This transfer is not permitted for your account.',
      );

    const csrf = await csrfToken();
    if (!csrf.token) {
      const status = csrf.response?.status ?? 502;
      return fail(
        status,
        status === 401 ? 'SESSION_EXPIRED' : 'CSRF_UNAVAILABLE',
        status === 401
          ? 'Your session has expired. Sign in before retrying this transfer.'
          : 'The secure transfer check could not be completed. No transfer was submitted.',
      );
    }

    let response: Response;
    try {
      response = await backendRequest('transfers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-csrf-token': csrf.token,
        },
        signal: AbortSignal.timeout(35_000),
        body: JSON.stringify(command),
      });
    } catch {
      return fail(
        503,
        'TRANSFER_OUTCOME_UNKNOWN',
        'We could not confirm whether the transfer completed. Verify this same transfer before trying anything else.',
        'unknown',
      );
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return safeApiFailure(response.status, body);
    }
    if (response.status !== 201) {
      return fail(
        502,
        'TRANSFER_OUTCOME_UNKNOWN',
        'We could not confirm whether the transfer completed. Verify this same transfer before trying anything else.',
        'unknown',
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (
      !isTransferResult(body) ||
      body.amountMinor !== command.amountMinor ||
      body.sourceWalletId !== command.sourceWalletId ||
      body.destinationWalletId !== command.destinationWalletId
    ) {
      return fail(
        502,
        'TRANSFER_OUTCOME_UNKNOWN',
        'The transfer response could not be verified. Retry safely to check this same transfer.',
        'unknown',
      );
    }
    return json(
      {
        amountMinor: body.amountMinor,
        completedAt: body.completedAt,
        destinationBalanceMinor: body.destinationBalanceMinor,
        destinationWalletId: body.destinationWalletId,
        journalId: body.journalId,
        sourceBalanceMinor: body.sourceBalanceMinor,
        sourceWalletId: body.sourceWalletId,
        status: body.status,
        transferId: body.transferId,
      },
      201,
    );
  } catch {
    return fail(
      503,
      'TRANSFER_REQUEST_FAILED',
      'The transfer could not be submitted. Please try again.',
      'failed',
    );
  }
}
