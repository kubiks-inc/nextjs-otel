import { trace, SpanKind, SpanStatusCode, Span } from '@opentelemetry/api';
import { flatten } from 'flat';

interface FetchInterceptorOptions {
    captureRequestBody?: boolean;
    captureResponseBody?: boolean;
    captureHeaders?: boolean;
    maxBodySize?: number;
}

/**
 * Fetch interceptor that captures request/response bodies
 * This is an alternative to undici instrumentation that provides full body capture
 */
export class FetchInterceptor {
    private options: FetchInterceptorOptions;
    private originalFetch: typeof fetch;

    constructor(options: FetchInterceptorOptions = {}) {
        this.options = {
            captureRequestBody: true,
            captureResponseBody: true,
            captureHeaders: true,
            maxBodySize: 10000,
            ...options
        };
        
        console.debug('FetchInterceptor: Initializing with options', this.options);
        this.originalFetch = globalThis.fetch;
        console.debug('FetchInterceptor: Original fetch stored:', typeof this.originalFetch);
        this.interceptFetch();
        console.debug('FetchInterceptor: Fetch intercepted, new fetch type:', typeof globalThis.fetch);
    }

    private interceptFetch() {
        const self = this;
        
        globalThis.fetch = async function(input: any, init?: any): Promise<Response> {
            console.debug('FetchInterceptor: Intercepted fetch call', { 
                url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
                method: init?.method || 'GET'
            });
            
            const tracer = trace.getTracer('fetch-interceptor');
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const method = init?.method || 'GET';
            
            return tracer.startActiveSpan(`fetch ${method}`, {
                kind: SpanKind.CLIENT,
                attributes: {
                    'http.method': method,
                    'http.url': url,
                    'http.scheme': new URL(url).protocol.slice(0, -1),
                    'http.host': new URL(url).host,
                    'kubiks.otel.source': 'otel-nextjs',
                    'kubiks.otel.version': '1.0.11',
                    'kubiks.otel.instrumentation': 'fetch-interceptor',
                }
            }, async (span: Span) => {
                try {
                    // Capture request details
                    if (self.options.captureHeaders && init?.headers) {
                        const headers = self.normalizeHeaders(init.headers);
                        span.setAttributes(flatten({ request: { headers } }));
                    }

                    // Capture request body
                    if (self.options.captureRequestBody && init?.body) {
                        const bodyData = await self.captureRequestBody(init.body, init.headers);
                        if (bodyData) {
                            // Store as single attribute, not flattened
                            span.setAttribute('request.body', typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
                        }
                    }

                    // Make the actual request
                    const response = await self.originalFetch(input, init);

                    // Capture response details
                    span.setAttributes({
                        'http.status_code': response.status,
                        'http.status_text': response.statusText,
                    });

                    if (self.options.captureHeaders) {
                        const responseHeaders: Record<string, string> = {};
                        response.headers.forEach((value, key) => {
                            responseHeaders[key.toLowerCase()] = value;
                        });
                        span.setAttributes(flatten({ response: { headers: responseHeaders } }));
                    }

                    // Capture response body (clone the response to avoid consuming the stream)
                    if (self.options.captureResponseBody) {
                        const responseClone = response.clone();
                        const bodyData = await self.captureResponseBody(responseClone);
                        if (bodyData) {
                            // Store as single attribute, not flattened
                            span.setAttribute('response.body', typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
                        }
                    }

                    span.setStatus({ code: SpanStatusCode.OK });
                    return response;

                } catch (error) {
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error'
                    });
                    throw error;
                } finally {
                    span.end();
                }
            });
        };
    }

    private async captureRequestBody(body: BodyInit, headers?: HeadersInit): Promise<any> {
        try {
            const contentType = this.getContentType(headers);
            
            if (body instanceof FormData) {
                // Don't capture FormData (likely file uploads)
                return { _type: 'FormData', _note: 'FormData not captured (likely contains files)' };
            }
            
            if (body instanceof URLSearchParams) {
                const obj: Record<string, string> = {};
                body.forEach((value, key) => {
                    obj[key] = value;
                });
                return obj;
            }
            
            if (body instanceof ReadableStream) {
                // Don't consume streams
                return { _type: 'ReadableStream', _note: 'Stream not captured' };
            }
            
            if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
                // Check if it's likely binary
                const bytes = new Uint8Array(body instanceof ArrayBuffer ? body : body.buffer);
                if (this.isBinary(bytes)) {
                    return { _type: 'Binary', _size: bytes.length, _note: 'Binary data not captured' };
                }
                
                const text = new TextDecoder().decode(bytes);
                return this.parseBodyText(text, contentType);
            }
            
            if (typeof body === 'string') {
                if (body.length > this.options.maxBodySize!) {
                    return { _truncated: true, _size: body.length, _preview: body.substring(0, 100) };
                }
                return this.parseBodyText(body, contentType);
            }
            
            return body;
        } catch (error) {
            return { _error: 'Failed to capture request body', _message: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    private async captureResponseBody(response: Response): Promise<any> {
        try {
            const contentType = response.headers.get('content-type') || '';
            const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
            
            // Skip large responses
            if (contentLength > this.options.maxBodySize!) {
                return { 
                    _truncated: true, 
                    _size: contentLength, 
                    _note: `Response too large (${contentLength} bytes)` 
                };
            }
            
            // Skip binary content
            if (this.isBinaryContentType(contentType)) {
                return { 
                    _type: 'Binary', 
                    _contentType: contentType, 
                    _size: contentLength, 
                    _note: 'Binary content not captured' 
                };
            }
            
            const text = await response.text();
            
            if (text.length > this.options.maxBodySize!) {
                return { 
                    _truncated: true, 
                    _size: text.length, 
                    _preview: text.substring(0, 100) 
                };
            }
            
            return this.parseBodyText(text, contentType);
        } catch (error) {
            return { _error: 'Failed to capture response body', _message: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    private parseBodyText(text: string, contentType?: string): any {
        try {
            if (!contentType) {
                // Try to parse as JSON first
                try {
                    return JSON.parse(text);
                } catch {
                    return text;
                }
            }
            
            const lowerContentType = contentType.toLowerCase();
            
            if (lowerContentType.includes('application/json')) {
                return JSON.parse(text);
            } else if (lowerContentType.includes('application/x-www-form-urlencoded')) {
                return Object.fromEntries(new URLSearchParams(text));
            } else if (lowerContentType.includes('text/')) {
                return text;
            } else {
                // Try JSON, fall back to text
                try {
                    return JSON.parse(text);
                } catch {
                    return text;
                }
            }
        } catch (error) {
            return text; // Return raw text if parsing fails
        }
    }

    private normalizeHeaders(headers: HeadersInit): Record<string, string> {
        const normalized: Record<string, string> = {};
        
        if (headers instanceof Headers) {
            headers.forEach((value, key) => {
                normalized[key.toLowerCase()] = value;
            });
        } else if (Array.isArray(headers)) {
            for (const [key, value] of headers) {
                normalized[key.toLowerCase()] = value;
            }
        } else if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                normalized[key.toLowerCase()] = value;
            }
        }
        
        return normalized;
    }

    private getContentType(headers?: HeadersInit): string | undefined {
        if (!headers) return undefined;
        
        const normalized = this.normalizeHeaders(headers);
        return normalized['content-type'];
    }

    private isBinary(bytes: Uint8Array): boolean {
        // Simple heuristic: if more than 30% of bytes are non-printable, consider it binary
        const nonPrintableCount = Array.from(bytes).filter(byte => 
            byte < 32 && byte !== 9 && byte !== 10 && byte !== 13
        ).length;
        
        return nonPrintableCount / bytes.length > 0.3;
    }

    private isBinaryContentType(contentType: string): boolean {
        const binaryTypes = [
            'image/',
            'video/',
            'audio/',
            'application/octet-stream',
            'application/pdf',
            'application/zip',
            'multipart/form-data',
        ];
        
        const lowerContentType = contentType.toLowerCase();
        return binaryTypes.some(type => lowerContentType.includes(type));
    }

    restore() {
        globalThis.fetch = this.originalFetch;
    }
}

// Auto-initialize if used in Node.js environment
let interceptorInstance: FetchInterceptor | null = null;

export function enableFetchBodyCapture(options: FetchInterceptorOptions = {}) {
    if (interceptorInstance) {
        interceptorInstance.restore();
    }
    interceptorInstance = new FetchInterceptor(options);
    return interceptorInstance;
}

export function disableFetchBodyCapture() {
    if (interceptorInstance) {
        interceptorInstance.restore();
        interceptorInstance = null;
    }
}