# NextJS Kubiks OpenTelemetry SDK

Instrument your Node.js applications with OpenTelemetry and send the traces to [Kubiks](https://kubiks.ai).

![Kubiks ServiceMap](./traces.png)
  
## Example

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
    });

    sdk.start();
  }
}
```

### Advanced Configuration

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, StripePlugin, getEnhancedHttpInstrumentations } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      // Add custom instrumentations alongside defaults
      instrumentations: [
        ...getEnhancedHttpInstrumentations({ 
          plugins: [
            new StripePlugin() // Add custom plugins
          ]
        }),
        // Add other instrumentations here
      ]
    });

    sdk.start();
  }
}
```

### Disable Default Instrumentations

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, BetterHttpInstrumentation } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      includeDefaultInstrumentations: false, // Disable defaults
      instrumentations: [
        // Provide your own instrumentations
        new BetterHttpInstrumentation()
      ]
    });

    sdk.start();
  }
}
```