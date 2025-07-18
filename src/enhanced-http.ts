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
    
    console.debug('EnhancedHttpInstrumentations: Configuring with options', {
        enableFetchBodyCapture: options.enableFetchBodyCapture,
        includeUndiciInstrumentation: options.includeUndiciInstrumentation,
        captureBody: options.captureBody
    });
    
    // Strategy: Choose ONE approach to avoid duplicate spans
    if (options.enableFetchBodyCapture) {
        // Option 1: Use fetch interceptor for client requests + BetterHTTP for server requests
        console.debug('EnhancedHttpInstrumentations: Using fetch interceptor + BetterHTTP strategy');
        
        // BetterHTTP handles server requests (incoming)
        instrumentations.push(new BetterHttpInstrumentation(options));
        
        // Fetch interceptor handles client requests (outgoing fetch calls)
        try {
            enableFetchBodyCapture({
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
                maxBodySize: 10000,
            });
            console.debug('EnhancedHttpInstrumentations: Fetch interceptor enabled');
        } catch (error) {
            console.warn('EnhancedHttpInstrumentations: Failed to enable fetch interceptor:', error.message);
        }
        
    } else {
        // Option 2: Use BetterHTTP + EnhancedUndici (traditional OpenTelemetry approach)
        console.debug('EnhancedHttpInstrumentations: Using BetterHTTP + EnhancedUndici strategy');
        
        // BetterHTTP handles both server and client HTTP requests
        instrumentations.push(new BetterHttpInstrumentation(options));
        
        // EnhancedUndici handles fetch requests specifically
        if (options.includeUndiciInstrumentation !== false) {
            try {
                instrumentations.push(new EnhancedUndiciInstrumentation({
                    requireParentforSpans: options.requireParentforOutgoingSpans,
                    captureRequestBody: options.captureBody,
                    captureResponseBody: options.captureBody,
                    captureHeaders: options.captureHeaders,
                }));
                console.debug('EnhancedHttpInstrumentations: EnhancedUndici enabled');
            } catch (error) {
                console.warn('EnhancedHttpInstrumentations: EnhancedUndici not available:', error.message);
            }
        }
    }
    
    console.debug('EnhancedHttpInstrumentations: Configured', instrumentations.length, 'instrumentations');
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