import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";
import { EnhancedUndiciInstrumentation } from "./enhanced-undici.ts";
import { enableFetchBodyCapture } from "./fetch-interceptor.ts";

export interface EnhancedHttpInstrumentationOptions extends BetterHttpInstrumentationOptions {
    /**
     * Enable full fetch body capture using response interception
     * This provides complete request/response body capture for fetch calls
     * but requires monkey-patching the global fetch function
     * @default true
     */
    enableFetchBodyCapture?: boolean;
}

/**
 * Enhanced HTTP Instrumentation that includes both HTTP and Undici instrumentation
 * for comprehensive coverage of Node.js HTTP clients and Next.js fetch
 */
export function getEnhancedHttpInstrumentations(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    
    // Always include the Better HTTP Instrumentation
    instrumentations.push(new BetterHttpInstrumentation(options));
    
    // Include Enhanced Undici instrumentation by default (for Next.js fetch support with payload capture)
    // BUT disable it if fetch body capture is enabled to avoid conflicts
    if (options.includeUndiciInstrumentation !== false && !options.enableFetchBodyCapture) {
        try {
            instrumentations.push(new EnhancedUndiciInstrumentation({
                requireParentforSpans: options.requireParentforOutgoingSpans,
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
            }));
            console.debug('EnhancedUndiciInstrumentation: Enabled (fetch body capture disabled)');
        } catch (error) {
            console.warn('EnhancedUndiciInstrumentation not available, skipping. This may affect Next.js fetch tracing.', error.message);
        }
    } else if (options.enableFetchBodyCapture) {
        console.debug('EnhancedUndiciInstrumentation: Disabled (fetch body capture enabled to avoid conflicts)');
    }
    
    // Optionally enable fetch body capture using interception
    if (options.enableFetchBodyCapture) {
        try {
            enableFetchBodyCapture({
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
                maxBodySize: 10000,
            });
            console.debug('Fetch body capture enabled via interception');
        } catch (error) {
            console.warn('Failed to enable fetch body capture:', error.message);
        }
    }
    
    return instrumentations;
}

/**
 * Backwards compatible BetterHttpInstrumentation with optional Undici support
 */
export class EnhancedHttpInstrumentation extends BetterHttpInstrumentation {
    constructor(options: BetterHttpInstrumentationOptions = {}) {
        super(options);
        
        if (options.includeUndiciInstrumentation !== false) {
            console.info('EnhancedHttpInstrumentation: Consider using getEnhancedHttpInstrumentations() for full Next.js fetch support');
        }
    }
}