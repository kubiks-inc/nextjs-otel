# Next.js Auto Instrumentation with OpenTelemetry

A Next.js telemetry package that provides automatic OpenTelemetry instrumentation for Next.js applications out of the box, with enhanced console logging capabilities.

## Features

- ✅ **Auto Instrumentation**: Automatic OpenTelemetry setup for Next.js applications
- ✅ **Console Log Instrumentation**: Automatically captures and forwards console logs to OpenTelemetry
- ✅ **Zero Configuration**: Works out of the box with minimal setup
- ✅ **TypeScript Support**: Full type definitions included
- ✅ **Configurable**: Optional console patching and flexible configuration options
- ✅ **Production Ready**: Optimized for production Next.js applications

## Installation

```bash
npm install @kubiks/nextjs-otel
# or
yarn add @kubiks/nextjs-otel
# or
pnpm add @kubiks/nextjs-otel
```

## Usage

### Basic Usage

Set up auto instrumentation in your Next.js `instrumentation.ts` file:

```typescript
// instrumentation.ts
import { registerTelemetry } from 'kubiks/nextjs-otel';

export function register() {
    registerTelemetry({
        config: {
            serviceName: 'my-nextjs-app',
        },
        enableConsolePatching: true // optional, defaults to true
    });
}
```

### Advanced Usage

```typescript
import { registerTelemetry, flushLogs } from 'kubiks/nextjs-otel';

export function register() {
    registerTelemetry({
        config: {
            serviceName: 'my-nextjs-app',
            // Additional OpenTelemetry configuration options
        },
        enableConsolePatching: true
    });
}

// Manually flush logs if needed (usually not required)
export { flushLogs };
```

### Simplified API

For quick setup with default options:

```typescript
import { registerOTelWithLogging } from 'kubiks/nextjs-otel';

export function register() {
    // Quick setup with console logging enabled by default
    registerOTelWithLogging({
        serviceName: 'my-nextjs-app',
    });
}
```

### Disable Console Patching

If you want to disable console log instrumentation:

```typescript
import { registerTelemetry } from 'kubiks/nextjs-otel';

export function register() {
    registerTelemetry({
        config: {
            serviceName: 'my-nextjs-app',
        },
        enableConsolePatching: false
    });
}
```

## Environment Variables

The package respects standard OpenTelemetry environment variables:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: The OTLP endpoint URL
- `OTEL_EXPORTER_OTLP_HEADERS`: Headers for authentication (e.g., API keys)
- `OTEL_SERVICE_NAME`: Service name (can be overridden in config)

## How It Works

1. **Auto Instrumentation**: Automatically sets up OpenTelemetry instrumentation for Next.js
2. **Console Patching**: Intercepts console.log, console.error, console.warn, etc. and converts them to OpenTelemetry log records
3. **Automatic Flushing**: Buffers logs and automatically flushes them every 5 seconds
4. **Process Exit Handling**: Attempts to flush remaining logs on process termination
5. **Zero Configuration**: Works with sensible defaults while allowing customization

## Console Log Instrumentation

One of the key features of this package is automatic console log instrumentation. When enabled (default), all console output from your Next.js application is automatically captured and sent to your OpenTelemetry endpoint:

```typescript
// These will all be captured and sent to OpenTelemetry
console.log('User logged in:', userId);
console.error('Database connection failed:', error);
console.warn('Deprecated API usage detected');
console.info('Cache hit rate:', percentage);
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
interface TelemetryConfig {
    serviceName: string;
    [key: string]: any; // Supports all OpenTelemetry config options
}

interface TelemetryOptions {
    config: TelemetryConfig;
    enableConsolePatching?: boolean; // defaults to true
}
```

## License

MIT 