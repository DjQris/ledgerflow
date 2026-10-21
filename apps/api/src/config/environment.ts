const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  SERVICE_NAME: string;
}

export function validateEnvironment(
  values: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnvironment = values.NODE_ENV ?? 'development';
  const rawPort = values.PORT ?? 3000;
  const serviceName = values.SERVICE_NAME ?? 'ledgerflow-api';

  if (
    typeof nodeEnvironment !== 'string' ||
    !NODE_ENVIRONMENTS.includes(nodeEnvironment as NodeEnvironment)
  ) {
    throw new Error(`NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  const port = typeof rawPort === 'number' ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
    throw new Error('SERVICE_NAME must be a non-empty string');
  }

  return {
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PORT: port,
    SERVICE_NAME: serviceName.trim(),
  };
}
