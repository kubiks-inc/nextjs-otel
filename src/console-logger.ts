import {
    LoggerProvider,
    BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
    trace,
    SpanStatusCode,
    context,
    SpanKind,
} from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

// Define severity numbers locally since they're not exported from @opentelemetry/api
enum SeverityNumber {
    TRACE = 1,
    DEBUG = 5,
    INFO = 9,
    WARN = 13,
    ERROR = 17,
    FATAL = 21,
}

// Note: Don't initialize context manager here as it should be done globally by the main SDK
// The fetch interceptor and console logger should use the same global context manager

// Simple HTTP Log Exporter
class SimpleOTLPLogExporter {
    private url: string;
    private headers: Record<string, string>;

    constructor(config: { url: string; headers?: Record<string, string> }) {
        this.url = config.url;
        this.headers = config.headers || {};
    }

    async export(logs: any[]): Promise<void> {
        if (logs.length === 0) return;

        // Get current service name (it may have been updated after exporter creation)
        const currentServiceName = serviceName;

        const payload = {
            resourceLogs: [
                {
                    resource: {
                        attributes: [
                            {
                                key: 'service.name',
                                value: { stringValue: currentServiceName }
                            },
                            {
                                key: 'kubiks.otel.source',
                                value: { stringValue: 'otel-nextjs' }
                            },
                            {
                                key: 'kubiks.otel.instrumentation',
                                value: { stringValue: 'console-logger' }
                            }
                        ]
                    },
                    scopeLogs: [
                        {
                            scope: { name: 'console-logger', version: '1.0.15' },
                            logRecords: logs.map(log => {
                                // Extract trace context from log record
                                const spanContext = log.spanContext;
                                const traceId = spanContext?.traceId;
                                const spanId = spanContext?.spanId;

                                return {
                                    timeUnixNano: (log.hrTime[0] * 1_000_000_000 + log.hrTime[1]).toString(),
                                    severityText: log.severityText,
                                    severityNumber: log.severityNumber,
                                    body: { stringValue: log.body },
                                    attributes: Object.entries(log.attributes || {}).map(([key, value]) => ({
                                        key,
                                        value: { stringValue: String(value) }
                                    })),
                                    ...(traceId && { traceId }),
                                    ...(spanId && { spanId }),
                                };
                            })
                        }
                    ]
                }
            ]
        };

        try {
            await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers,
                },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            // Silently handle errors
        }
    }

    async shutdown(): Promise<void> {
        // No-op for simple exporter
    }

    async forceFlush(): Promise<void> {
        // No-op for simple exporter
    }
}

// Store original console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
};

const consoleToSeverity = {
    log: 'INFO',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG',
} as const;

const consoleToSeverityNumber = {
    log: SeverityNumber.INFO,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
    debug: SeverityNumber.DEBUG,
} as const;

// Global variables for OpenTelemetry components
let serviceName = 'nextjs-app'; // Default service name
let provider: LoggerProvider;
let logger: any;
let tracer: any;
let exporter: SimpleOTLPLogExporter;

// Initialize OpenTelemetry components
function initializeOTel() {
    const apiKey = process.env.KUBIKS_API_KEY;
    exporter = new SimpleOTLPLogExporter({
        url: process.env.COLLECTOR_URL ? `${process.env.COLLECTOR_URL}/v1/logs` : "https://otlp.kubiks.ai/v1/logs",
        headers: apiKey ? {
            "X-Kubiks-Key": apiKey,
        } : {},
    });

    // Create resource with service name
    const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.15",
        'kubiks.otel.source': 'otel-nextjs',
        'kubiks.otel.instrumentation': 'console-logger',
    });

    provider = new LoggerProvider({ resource });
    const processor = new BatchLogRecordProcessor(exporter as any);
    provider.addLogRecordProcessor(processor);

    logger = provider.getLogger('console-logger', '1.0.15');
    tracer = trace.getTracer(serviceName, "1.0.15");
}

// Register OpenTelemetry with custom service name
export function registerOTel(serviceNameParam: string) {
    serviceName = serviceNameParam;
    initializeOTel();
}

// Don't initialize automatically - wait for explicit service name configuration
// initializeOTel();

let isPatched = false;

function getOrCreateTraceContext(): { traceId: string; spanId: string } {
    // Try to get active span from the current active context
    const activeSpan = trace.getActiveSpan();
    
    if (activeSpan && activeSpan.spanContext().traceId !== '00000000000000000000000000000000') {
        const spanContext = activeSpan.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
        };
    }

    // If no active span, try to get from context directly
    const ctx = context.active();
    const spanFromContext = trace.getSpan(ctx);
    
    if (spanFromContext && spanFromContext.spanContext().traceId !== '00000000000000000000000000000000') {
        const spanContext = spanFromContext.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
        };
    }

    // No active span found, return empty IDs to indicate no trace context
    return {
        traceId: '',
        spanId: '',
    };
}

export function patchConsole(): void {
    // Prevent double patching
    if (isPatched) return;
    
    // Ensure logger is initialized before patching
    if (!logger) {
        initializeOTel();
    }

    Object.entries(originalConsole).forEach(([method, originalFn]) => {
        console[method as keyof typeof originalConsole] = (...args: any[]) => {
            // Call original console method first
            originalFn.apply(console, args);

            // Execute within the current context to ensure trace propagation
            const currentContext = context.active();
            context.with(currentContext, () => {
                // Get or create trace context
                const { traceId, spanId } = getOrCreateTraceContext();

                // Create log message - preserve raw format without object parsing
                const message = args
                    .map((arg) => {
                        if (typeof arg === "string") {
                            return arg;
                        } else if (typeof arg === "number" || typeof arg === "boolean") {
                            return String(arg);
                        } else if (arg instanceof Error) {
                            // For Error objects, include the full stack trace
                            return arg.stack || arg.message || String(arg);
                        } else if (typeof arg === "object" && arg !== null) {
                            // For other objects, use JSON.stringify but handle special cases
                            try {
                                return JSON.stringify(arg);
                            } catch (error) {
                                // For circular references or other issues, use string representation
                                return String(arg);
                            }
                        } else {
                            return String(arg);
                        }
                    })
                    .join(" ");

                // Build basic attributes without object parsing
                const attributes: Record<string, string> = {
                    source: "console",
                    'log.type': method,
                    'service.name': serviceName, // This will use the current service name
                    'trace.id': traceId,
                    'span.id': spanId,
                };

                // Send to OpenTelemetry using direct exporter approach
                const activeSpan = trace.getActiveSpan();
                
                const logRecord = {
                    timestamp: Date.now(),
                    hrTime: [Math.floor(Date.now() / 1000), (Date.now() % 1000) * 1000000],
                    body: message,
                    severityText: consoleToSeverity[method as keyof typeof consoleToSeverity],
                    severityNumber: consoleToSeverityNumber[method as keyof typeof consoleToSeverityNumber],
                    attributes: {
                        ...attributes,
                        // Override trace context in attributes with the found values
                        'trace.id': traceId,
                        'span.id': spanId,
                    },
                    spanContext: activeSpan?.spanContext(),
                };

                // Export directly to avoid complex SDK integration
                try {
                    exporter.export([logRecord]);
                } catch (error) {
                    // Silently handle export errors
                }
            });
        };
    });

    isPatched = true;

    // Set up process exit handler to flush remaining logs (Node.js runtime only)
    // Skip in Edge Runtime where process.on is not available
    try {
        if (typeof process !== 'undefined' &&
            typeof process.on === 'function' &&
            typeof process.env !== 'undefined') {
            const exitHandler = async () => {
                await flushLogs();
            };

            process.on('exit', exitHandler);
            process.on('SIGINT', exitHandler);
            process.on('SIGTERM', exitHandler);
            process.on('uncaughtException', exitHandler);
        }
    } catch (error) {
        // Silently skip process handlers in Edge Runtime or other environments
        // where process.on is not available
    }
}

// Flush logs to OTEL
export async function flushLogs(): Promise<void> {
    try {
        await provider.forceFlush();
    } catch (error) {
        // Silently handle flush errors
    }
}

// Export provider and tracer for external use
export { provider as logProvider, tracer };

// Helper function to manually start a trace
export function startTrace(name: string = "manual-trace"): { traceId: string; spanId: string; endTrace: () => void } {
    const span = tracer.startSpan(name, {
        kind: SpanKind.INTERNAL,
    });

    const spanContext = span.spanContext();

    return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        endTrace: () => {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
        }
    };
}

// Helper function to run code within a trace context
export function runInTrace<T>(name: string, fn: () => T): T {
    const span = tracer.startSpan(name, {
        kind: SpanKind.INTERNAL,
    });

    return context.with(trace.setSpan(context.active(), span), () => {
        try {
            const result = fn();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error)
            });
            throw error;
        } finally {
            span.end();
        }
    });
}

// Helper function to run async code within a trace context
export async function runInTraceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const span = tracer.startSpan(name, {
        kind: SpanKind.INTERNAL,
    });

    return await context.with(trace.setSpan(context.active(), span), async () => {
        try {
            const result = await fn();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error)
            });
            throw error;
        } finally {
            span.end();
        }
    });
} 