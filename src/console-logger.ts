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

// Initialize context manager
const contextManager = new AsyncHooksContextManager();
context.setGlobalContextManager(contextManager);

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

        const payload = {
            resourceLogs: [
                {
                    resource: {
                        attributes: [
                            {
                                key: 'service.name',
                                value: { stringValue: serviceName }
                            }
                        ]
                    },
                    scopeLogs: [
                        {
                            scope: { name: 'console-logger' },
                            logRecords: logs.map(log => {
                                // Extract trace ID and span ID from attributes
                                const traceId = log.attributes?.['trace.id'];
                                const spanId = log.attributes?.['span.id'];

                                return {
                                    timeUnixNano: (Date.now() * 1_000_000).toString(),
                                    severityText: log.severityText,
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

// Helper function to extract API key from OTEL_EXPORTER_OTLP_HEADERS
function extractApiKey(): string | undefined {
    const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS;
    if (!headers) return undefined;

    const match = headers.match(/X-Kubiks-Key=(.+)/);
    return match ? match[1] : undefined;
}

// Global variables for OpenTelemetry components
let serviceName = 'nextjs-app'; // Default service name
let provider: LoggerProvider;
let logger: any;
let tracer: any;
let exporter: SimpleOTLPLogExporter;

// Initialize OpenTelemetry components
function initializeOTel() {
    const apiKey = extractApiKey();
    exporter = new SimpleOTLPLogExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` : "https://otlp.kubiks.ai/v1/logs",
        headers: apiKey ? {
            "X-Kubiks-Key": apiKey,
        } : {},
    });

    provider = new LoggerProvider();
    const processor = new BatchLogRecordProcessor(exporter as any);
    (provider as any).addLogRecordProcessor(processor);

    logger = provider.getLogger(serviceName);
    tracer = trace.getTracer(serviceName, "1.0.0");
}

// Register OpenTelemetry with custom service name
export function registerOTel(serviceNameParam: string) {
    serviceName = serviceNameParam;
    initializeOTel();
}

// Initialize with default service name
initializeOTel();

let isPatched = false;

function getOrCreateTraceContext(): { traceId: string; spanId: string } {
    const activeSpan = trace.getActiveSpan();

    if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
        };
    }

    // No active span, create a new one
    const span = tracer.startSpan("console-log", {
        kind: SpanKind.INTERNAL,
    });

    const spanContext = span.spanContext();

    // End the span after a short delay to avoid keeping it open indefinitely
    setTimeout(() => {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
    }, 100);

    return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
    };
}

export function patchConsole(): void {
    // Prevent double patching
    if (isPatched) return;

    Object.entries(originalConsole).forEach(([method, originalFn]) => {
        console[method as keyof typeof originalConsole] = (...args: any[]) => {
            // Call original console method first
            originalFn.apply(console, args);

            // Get or create trace context
            const { traceId, spanId } = getOrCreateTraceContext();

            // Create log message
            const message = args
                .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
                .join(" ");

            // Build attributes including object parameters
            const attributes: Record<string, string> = {
                source: "console",
                'log.type': method,
                'service.name': serviceName,
                'trace.id': traceId,
                'span.id': spanId,
            };

            // Add object parameters to attributes for filtering
            args.forEach((arg) => {
                if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
                    try {
                        // Add individual properties directly using field names
                        Object.entries(arg).forEach(([key, value]) => {
                            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                                attributes[key] = String(value);
                            }
                        });
                    } catch (error) {
                        // Skip objects that can't be stringified (circular references, etc.)
                    }
                }
            });

            // Send to OpenTelemetry
            logger.emit({
                body: message,
                severityText: consoleToSeverity[method as keyof typeof consoleToSeverity],
                attributes,
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