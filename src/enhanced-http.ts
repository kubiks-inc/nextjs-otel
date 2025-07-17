import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";

/**
 * Enhanced HTTP Instrumentation that includes both HTTP and Undici instrumentation
 * for comprehensive coverage of Node.js HTTP clients and Next.js fetch
 */
export function getEnhancedHttpInstrumentations(options: BetterHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    
    // Always include the Better HTTP Instrumentation
    instrumentations.push(new BetterHttpInstrumentation(options));
    
    // Include Undici instrumentation by default (for Next.js fetch support)
    if (options.includeUndiciInstrumentation !== false) {
        try {
            // Dynamic import to avoid bundling issues in browser environments
            const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
            instrumentations.push(new UndiciInstrumentation({
                requireParentforOutgoingSpans: options.startOutgoingSpanHook ? false : undefined,
            }));
        } catch (error) {
            console.warn('UndiciInstrumentation not available, skipping. This may affect Next.js fetch tracing.', error.message);
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