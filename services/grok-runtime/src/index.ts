import { config } from './config.js';
import { createGrokRuntimeApp } from './app.js';

createGrokRuntimeApp().listen(config.port, '0.0.0.0', () => {
  console.log(`grok-runtime listening on ${config.port}`);
});
