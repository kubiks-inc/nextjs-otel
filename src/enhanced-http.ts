import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";
import { EnhancedUndiciInstrumentation } from "./enhanced-undici.ts";
import { enableFetchBodyCapture } from "./fetch-interceptor.ts";

export interface EnhancedHttpInstrumentationOptions extends BetterHttpInstrumentationOptions {
    /**
     * Enable full fetch body capture using response interception
     * This provides complete request/response body capture for fetch calls
     * but requires monkey-patching the global fetch function
     * @default false (disabled to prevent duplicate spans)
     */
    enableFetchBodyCapture?: boolean;
}

/**
 * Enhanced HTTP Instrumentation using only Undici instrumentation
 * to prevent duplicate spans while providing comprehensive coverage of Node.js HTTP clients and Next.js fetch
 */
export function getEnhancedHttpInstrumentations(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    
    // ONLY use Enhanced Undici instrumentation to avoid duplicate spans
    // This covers both undici and fetch calls in Node.js/Next.js environments
    try {
        instrumentations.push(new EnhancedUndiciInstrumentation({
            requireParentforSpans: options.requireParentforOutgoingSpans,
            captureRequestBody: options.captureBody,
            captureResponseBody: options.captureBody,
            captureHeaders: options.captureHeaders,
        }));
        console.debug('EnhancedUndiciInstrumentation: Enabled as the single HTTP instrumentation');
    } catch (error) {
        console.warn('EnhancedUndiciInstrumentation not available, falling back to BetterHttpInstrumentation', error.message);
        // Fallback to BetterHttpInstrumentation only if undici is not available
        instrumentations.push(new BetterHttpInstrumentation(options));
        console.debug('BetterHttpInstrumentation: Enabled as fallback');
    }
    
    // Disable fetch body capture to avoid conflicts with undici instrumentation
    console.debug('Fetch body capture disabled to prevent duplicate spans - using undici instrumentation only');
    
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