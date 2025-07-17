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
      // Automatically includes:
      // - HTTP instrumentation for Node.js requests
      // - Undici instrumentation for Next.js fetch with payload capture
      // - Full request/response body and header capture (non-binary only)
      // - Response body capture enabled by default
    });

    sdk.start();
  }
}
```

## Features

### 🚀 **Automatic Next.js Support**
- Traces both server-side requests (HTTP) and client-side fetch calls (Undici)
- Zero configuration required for Next.js applications

### 📝 **Smart Payload Capture**
- Automatically captures request/response bodies and headers
- Skips binary content (images, videos, file uploads) to avoid large traces
- Configurable size limits (default: 10KB)
- Supports JSON, form data, and text content
- **Full fetch response body capture** with optional interception

### 🔧 **Flexible Configuration**
- Works out-of-the-box with sensible defaults
- Fully customizable for advanced use cases
- Backwards compatible with existing setups

### Disable Response Body Capture (if needed)

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      enableFetchBodyCapture: false, // Disable if you don't want response bodies
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
          ],
          enableFetchBodyCapture: true, // Full body capture
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