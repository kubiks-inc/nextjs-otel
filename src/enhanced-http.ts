import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";
import { EnhancedUndiciInstrumentation } from "./enhanced-undici.ts";
import { enableFetchBodyCapture } from "./fetch-interceptor.ts";
import { patchConsole, registerOTel } from "./console-logger.ts";

export interface EnhancedHttpInstrumentationOptions extends BetterHttpInstrumentationOptions {
    /**
     * Enable full fetch body capture using response interception
     * This provides complete request/response body capture for fetch calls
     * but requires monkey-patching the global fetch function
     * @default true (fetch interceptor only to prevent duplicate spans)
     */
    enableFetchBodyCapture?: boolean;
    /**
     * Enable console log interception to send logs to OpenTelemetry
     * @default true
     */
    enableConsoleLogging?: boolean;
    /**
     * Service name for OpenTelemetry traces and logs
     * @default 'nextjs-app'
     */
    serviceName?: string;
}

/**
 * Enhanced HTTP Instrumentation with server-side instrumentation for incoming requests
 * and fetch interceptor for outgoing client calls to prevent duplicate spans
 */
export function getEnhancedHttpInstrumentations(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    
    // Initialize console logging if enabled (default: true)
    if (options.enableConsoleLogging !== false) {
        const serviceName = options.serviceName || 'nextjs-app';
        registerOTel(serviceName);
        patchConsole();
    }
    
    // ALWAYS include server-side HTTP instrumentation for incoming Next.js requests
    // This is configured to only instrument incoming requests, not outgoing client calls
    instrumentations.push(new BetterHttpInstrumentation({
        ...options,
        // Disable outgoing request instrumentation to prevent conflicts with fetch interceptor
        ignoreOutgoingRequestHook: () => true, // Skip all outgoing requests
        // Only instrument incoming server requests
        ignoreIncomingRequestHook: options.ignoreIncomingRequestHook,
    }));
    
    // Default to fetch interceptor for outgoing client calls (enableFetchBodyCapture defaults to true)
    if (options.enableFetchBodyCapture !== false) {
        // Use fetch interceptor for outgoing client calls only
        try {
            enableFetchBodyCapture({
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
                maxBodySize: 5242880, // 5MB
            });
        } catch (error) {
            console.warn('Failed to enable fetch body capture:', error.message);
            // Fallback to undici for outgoing calls if fetch interceptor fails
            instrumentations.push(new EnhancedUndiciInstrumentation({
                requireParentforSpans: options.requireParentforOutgoingSpans,
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
            }));
        }
    } else {
        // If fetch interceptor is explicitly disabled, use undici for outgoing calls
        try {
            instrumentations.push(new EnhancedUndiciInstrumentation({
                requireParentforSpans: options.requireParentforOutgoingSpans,
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
            }));
        } catch (error) {
            console.warn('EnhancedUndiciInstrumentation not available:', error.message);
        }
    }
    
    return instrumentations;
}

/**
 * Backwards compatible BetterHttpInstrumentation 
 * @deprecated Use getEnhancedHttpInstrumentations() for single instrumentation to avoid duplicates
 */
export class EnhancedHttpInstrumentation extends BetterHttpInstrumentation {
    constructor(options: BetterHttpInstrumentationOptions = {}) {
        super(options);
        
        console.warn('EnhancedHttpInstrumentation: This class may create duplicate spans. Use getEnhancedHttpInstrumentations() instead for single undici-based instrumentation.');
    }
}