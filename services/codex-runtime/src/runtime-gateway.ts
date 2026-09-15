import { config } from './config.js';
import { PrismGatewayClient } from './gateway-client.js';

export const gatewayClient = new PrismGatewayClient({
  enabled: config.prismGatewayEnabled,
  baseUrl: config.prismGatewayBaseUrl,
  token: config.prismGatewayToken,
  timeoutMs: config.prismGatewayTimeoutMs,
});
