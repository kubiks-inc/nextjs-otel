import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";
import { EnhancedUndiciInstrumentation } from "./enhanced-undici.ts";
import { enableFetchBodyCapture } from "./fetch-interceptor.ts";

export interface EnhancedHttpInstrumentationOptions extends BetterHttpInstrumentationOptions {
    /**
     * Enable full fetch body capture using response interception
     * This provides complete request/response body capture for fetch calls
     * but requires monkey-patching the global fetch function
     * @default true (fetch interceptor only to prevent duplicate spans)
     */
    enableFetchBodyCapture?: boolean;
}

/**
 * Enhanced HTTP Instrumentation using ONLY fetch interceptor by default
 * to prevent duplicate spans while providing comprehensive body capture for fetch calls
 */
export function getEnhancedHttpInstrumentations(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    
    // Default to fetch interceptor ONLY (enableFetchBodyCapture defaults to true)
    if (options.enableFetchBodyCapture !== false) {
        // Use fetch interceptor ONLY - no other HTTP instrumentations
        try {
            enableFetchBodyCapture({
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
                maxBodySize: 5242880, // 5MB
            });
            console.debug('Fetch interceptor enabled as the ONLY HTTP instrumentation');
        } catch (error) {
            console.warn('Failed to enable fetch body capture:', error.message);
        }
    } else {
        // Only if explicitly disabled, fall back to undici
        try {
            instrumentations.push(new EnhancedUndiciInstrumentation({
                requireParentforSpans: options.requireParentforOutgoingSpans,
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
            }));
            console.debug('EnhancedUndiciInstrumentation: Enabled (fetch interceptor disabled)');
        } catch (error) {
            console.warn('EnhancedUndiciInstrumentation not available, falling back to BetterHttpInstrumentation', error.message);
            instrumentations.push(new BetterHttpInstrumentation(options));
            console.debug('BetterHttpInstrumentation: Enabled as fallback');
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