import 'server-only';

import { backendRequest, currentSession } from '@/lib/auth/backend';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const minorUnits = /^(0|[1-9]\d*|-[1-9]\d*)$/;
const datestring = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function errorResponse(status: number): Response {
  const allowed = [400, 401, 403, 404, 429, 500, 503];
  const safeStatus = allowed.includes(status) ? status : 502;
  const message: Record<number, string> = {
    400: 'The request could not be completed.',
    401: 'Your session has ended. Please sign in again.',
    403: 'This request is not permitted.',
    404: 'The requested resource was not found.',
    429: 'Too many requests. Please wait and try again.',
    500: 'Something went wrong. Please try again.',
    502: 'The service returned an unexpected response.',
    503: 'Service is temporarily unavailable. Please try again.',
  };
  return json({ status: safeStatus, message: message[safeStatus] }, safeStatus);
}

async function customerAuthorized(): Promise<Response | null> {
  const session = await currentSession();
  if (!session.profile) return errorResponse(session.status);
  if (session.profile.role !== 'CUSTOMER') return errorResponse(403);
  return null;
}

function parseWallets(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const output: unknown[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const wallet = item as Record<string, unknown>;
    if (
      typeof wallet.id !== 'string' ||
      !uuidV4.test(wallet.id) ||
      typeof wallet.ownerReference !== 'string' ||
      wallet.ownerReference.length > 200 ||
      typeof wallet.status !== 'string' ||
      wallet.status.length > 40 ||
      wallet.currency !== 'NGN' ||
      typeof wallet.balanceMinor !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(wallet.balanceMinor) ||
      !datestring(wallet.createdAt) ||
      !datestring(wallet.updatedAt)
    )
      return null;
    output.push({
      balanceMinor: wallet.balanceMinor,
      createdAt: wallet.createdAt,
      currency: wallet.currency,
      id: wallet.id,
      ownerReference: wallet.ownerReference,
      status: wallet.status,
      updatedAt: wallet.updatedAt,
    });
  }
  return output;
}

function parseHistory(value: unknown): unknown | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as Record<string, unknown>;
  if (
    !Array.isArray(history.data) ||
    !history.pagination ||
    typeof history.pagination !== 'object'
  )
    return null;
  const data: unknown[] = [];
  for (const item of history.data) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      !uuidV4.test(row.id) ||
      typeof row.transactionId !== 'string' ||
      !uuidV4.test(row.transactionId) ||
      typeof row.amountMinor !== 'string' ||
      !minorUnits.test(row.amountMinor) ||
      !['INCOMING', 'OUTGOING', 'NEUTRAL'].includes(String(row.direction)) ||
      (row.counterpartyWalletId !== null &&
        (typeof row.counterpartyWalletId !== 'string' ||
          !uuidV4.test(row.counterpartyWalletId))) ||
      !['OPENING_FUNDING', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL'].includes(
        String(row.type),
      ) ||
      ![
        'PENDING',
        'POSTED',
        'VOIDED',
        'COMPLETED',
        'FAILED',
        'REVERSED',
      ].includes(String(row.status)) ||
      (row.description !== null &&
        (typeof row.description !== 'string' ||
          row.description.length > 500)) ||
      (row.externalReference !== null &&
        (typeof row.externalReference !== 'string' ||
          row.externalReference.length > 255)) ||
      !datestring(row.createdAt) ||
      (row.postedAt !== null && !datestring(row.postedAt))
    )
      return null;
    data.push({
      amountMinor: row.amountMinor,
      counterpartyWalletId: row.counterpartyWalletId,
      createdAt: row.createdAt,
      description: row.description,
      direction: row.direction,
      externalReference: row.externalReference,
      id: row.id,
      postedAt: row.postedAt,
      status: row.status,
      transactionId: row.transactionId,
      type: row.type,
    });
  }
  const page = history.pagination as Record<string, unknown>;
  if (
    ![page.page, page.pageSize, page.total, page.totalPages].every(
      (n) => Number.isSafeInteger(n) && (n as number) >= 0,
    )
  )
    return null;
  return {
    data,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: page.totalPages,
    },
  };
}

async function getJson(
  path: string,
): Promise<{ response: Response; body: unknown }> {
  const response = await backendRequest(path);
  if (!response.ok) return { response, body: null };
  try {
    return { response, body: (await response.json()) as unknown };
  } catch {
    return { response, body: null };
  }
}

export async function handleCustomerWallets(): Promise<Response> {
  try {
    const denied = await customerAuthorized();
    if (denied) return denied;
    const { response, body } = await getJson('wallets');
    if (!response.ok) return errorResponse(response.status);
    const wallets = parseWallets(body);
    return wallets ? json(wallets) : errorResponse(502);
  } catch {
    return errorResponse(503);
  }
}

export async function handleCustomerTransactions(
  request: Request,
  walletId: string,
): Promise<Response> {
  if (!uuidV4.test(walletId)) return errorResponse(400);
  const url = new URL(request.url);
  const pages = url.searchParams.getAll('page');
  const sizes = url.searchParams.getAll('pageSize');
  const allowed = [
    'page',
    'pageSize',
    'reference',
    'from',
    'to',
    'status',
    'direction',
    'sort',
  ];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)))
    return errorResponse(400);
  if (allowed.some((key) => url.searchParams.getAll(key).length > 1))
    return errorResponse(400);
  const page = pages[0] ?? '1';
  const pageSize = sizes[0] ?? '20';
  if (
    !/^[1-9]\d*$/.test(page) ||
    !/^[1-9]\d*$/.test(pageSize) ||
    Number(page) > 1_000_000 ||
    Number(pageSize) > 100
  )
    return errorResponse(400);
  const reference = url.searchParams.get('reference') ?? '';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const status = url.searchParams.get('status');
  const direction = url.searchParams.get('direction');
  const sort = url.searchParams.get('sort') ?? 'desc';
  if (
    reference.length > 100 ||
    (from && !Number.isFinite(Date.parse(from))) ||
    (to && !Number.isFinite(Date.parse(to))) ||
    (from && to && Date.parse(from) > Date.parse(to)) ||
    (status &&
      ![
        'PENDING',
        'POSTED',
        'VOIDED',
        'COMPLETED',
        'FAILED',
        'REVERSED',
      ].includes(status)) ||
    (direction && !['INCOMING', 'OUTGOING', 'NEUTRAL'].includes(direction)) ||
    !['asc', 'desc'].includes(sort)
  )
    return errorResponse(400);
  try {
    const denied = await customerAuthorized();
    if (denied) return denied;
    const query = new URLSearchParams({ page, pageSize, sort });
    for (const key of [
      'reference',
      'from',
      'to',
      'status',
      'direction',
    ] as const) {
      const value = url.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const { response, body } = await getJson(
      `wallets/${walletId}/transactions?${query}`,
    );
    if (!response.ok) return errorResponse(response.status);
    const history = parseHistory(body);
    return history ? json(history) : errorResponse(502);
  } catch {
    return errorResponse(503);
  }
}

function parseTransactionDetails(value: unknown): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const nullableUuid = (item: unknown) =>
    item === null || (typeof item === 'string' && uuidV4.test(item));
  if (
    typeof row.id !== 'string' ||
    !uuidV4.test(row.id) ||
    typeof row.amountMinor !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(row.amountMinor) ||
    typeof row.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    !['OPENING_FUNDING', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL'].includes(
      String(row.type),
    ) ||
    ![
      'PENDING',
      'POSTED',
      'VOIDED',
      'COMPLETED',
      'FAILED',
      'REVERSED',
    ].includes(String(row.status)) ||
    typeof row.createdAt !== 'string' ||
    !datestring(row.createdAt) ||
    (row.postedAt !== null && !datestring(row.postedAt)) ||
    (row.description !== null &&
      (typeof row.description !== 'string' || row.description.length > 500)) ||
    (row.externalReference !== null &&
      (typeof row.externalReference !== 'string' ||
        row.externalReference.length > 255)) ||
    !nullableUuid(row.walletId) ||
    !nullableUuid(row.sourceWalletId) ||
    !nullableUuid(row.destinationWalletId)
  )
    return null;
  return {
    amountMinor: row.amountMinor,
    createdAt: row.createdAt,
    currency: row.currency,
    description: row.description,
    destinationWalletId: row.destinationWalletId,
    externalReference: row.externalReference,
    id: row.id,
    postedAt: row.postedAt,
    sourceWalletId: row.sourceWalletId,
    status: row.status,
    type: row.type,
    walletId: row.walletId,
  };
}

export async function handleCustomerTransactionDetails(
  id: string,
): Promise<Response> {
  if (!uuidV4.test(id)) return errorResponse(400);
  try {
    const denied = await customerAuthorized();
    if (denied) return denied;
    const { response, body } = await getJson(`transactions/${id}`);
    if (!response.ok) return errorResponse(response.status);
    const details = parseTransactionDetails(body);
    return details ? json(details) : errorResponse(502);
  } catch {
    return errorResponse(503);
  }
}
