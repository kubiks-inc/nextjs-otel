# NextJS Kubiks OpenTelemetry SDK

Instrument your Node.js applications with OpenTelemetry and send the traces to [Kubiks](https://kubiks.ai).

![Kubiks ServiceMap](./traces.png)
  
## Example

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, VercelPlugin, BetterHttpInstrumentation } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      instrumentations: [
        new BetterHttpInstrumentation({ 
          plugins: [
            new VercelPlugin()
          ]
        }),
      ]
    });

    sdk.start();
  }
}
```