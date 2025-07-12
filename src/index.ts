import { registerOTel } from '@vercel/otel';
import { patchConsole, flushLogs } from './console-logger';

export interface TelemetryConfig {
    serviceName: string;
    [key: string]: any; // Allow other Vercel OTEL config options
}

export interface TelemetryOptions {
    /**
     * Configuration options passed to Vercel's registerOTel function
     */
    config: TelemetryConfig;
    /**
     * Whether to enable console log patching for OTEL log collection
     * @default true
     */
    enableConsolePatching?: boolean;
}

/**
 * Enhanced Next.js telemetry function that wraps Vercel's OTEL registration
 * and adds console log collection capabilities.
 * 
 * @param options - Configuration options
 * @example
 * ```typescript
 * import { registerTelemetry } from 'telemetry-nextjs';
 * 
 * export function register() {
 *     registerTelemetry({
 *         config: {
 *             serviceName: 'my-nextjs-app',
 *         },
 *         enableConsolePatching: true // optional, defaults to true
 *     });
 * }
 * ```
 */
export function registerTelemetry(options: TelemetryOptions): void {
    const { config, enableConsolePatching = true } = options;

    // Register Vercel OTEL instrumentation with the provided config
    registerOTel(config);

    // Optionally patch console for enhanced logging
    if (enableConsolePatching) {
        patchConsole();
    }
}

/**
 * For backwards compatibility - accepts the same parameters as Vercel's registerOTel
 * but with optional console patching enabled by default
 */
export function registerOTelWithLogging(
    config: TelemetryConfig,
    enableConsolePatching: boolean = true
): void {
    registerTelemetry({ config, enableConsolePatching });
}

// Re-export utilities for advanced usage
export {
    flushLogs,
    patchConsole,
    startTrace,
    runInTrace,
    runInTraceAsync,
    logProvider,
    tracer
} from './console-logger';

// Default export for convenience
export default registerTelemetry; 