export type TransferErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_TRANSFER'
  | 'SELF_TRANSFER'
  | 'TRANSFER_CONFLICT'
  | 'TRANSFER_PERSISTENCE_FAILURE'
  | 'WALLET_NOT_FOUND'
  | 'WALLET_UNAVAILABLE';

export class TransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidTransferError extends TransferError {
  constructor(message: string, options?: ErrorOptions) {
    super('INVALID_TRANSFER', message, options);
  }
}

export class SelfTransferError extends TransferError {
  constructor() {
    super('SELF_TRANSFER', 'Source and destination wallets must be different');
  }
}

export class WalletNotFoundError extends TransferError {
  constructor(walletId: string) {
    super('WALLET_NOT_FOUND', `Wallet ${walletId} was not found`);
  }
}

export class WalletUnavailableError extends TransferError {
  constructor(walletId: string) {
    super('WALLET_UNAVAILABLE', `Wallet ${walletId} is not active`);
  }
}

export class InsufficientFundsError extends TransferError {
  constructor() {
    super('INSUFFICIENT_FUNDS', 'The source wallet has insufficient funds');
  }
}

export class TransferConflictError extends TransferError {
  constructor(options?: ErrorOptions) {
    super(
      'TRANSFER_CONFLICT',
      'The transfer conflicted with another database transaction; retry it',
      options,
    );
  }
}

export class TransferPersistenceError extends TransferError {
  constructor(options?: ErrorOptions) {
    super(
      'TRANSFER_PERSISTENCE_FAILURE',
      'The transfer could not be committed',
      options,
    );
  }
}
