import { Span } from '@opentelemetry/api';
import { UndiciInstrumentation, UndiciInstrumentationConfig } from '@opentelemetry/instrumentation-undici';
import { flatten } from 'flat';
import { parse } from 'querystring';
import { getPackageVersion } from './version.js';

// List of sensitive headers to redact
const SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'x-kubiks-key',
    'bearer',
    'proxy-authorization',
    'www-authenticate',
    'proxy-authenticate',
];

// Function to parse JWT token and extract claims
function parseJWTClaims(token: string): Record<string, any> | null {
    try {
        // Remove "Bearer " prefix if present
        const cleanToken = token.replace(/^Bearer\s+/i, '');
        
        // JWT tokens have 3 parts separated by dots
        const parts = cleanToken.split('.');
        if (parts.length !== 3) {
            return null;
        }
        
        // Decode the payload (second part)
        const payload = parts[1];
        
        // Add padding if needed for base64 decoding
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        
        // Decode base64url
        const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        
        return JSON.parse(decoded);
    } catch (error) {
        return null;
    }
}

// Function to redact sensitive headers and extract JWT claims
function redactSensitiveHeaders(headers: Record<string, string>): { redactedHeaders: Record<string, string>, jwtClaims: Record<string, any> } {
    const redactedHeaders = { ...headers };
    let jwtClaims: Record<string, any> = {};
    
    for (const key in redactedHeaders) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_HEADERS.some(sensitive => lowerKey.includes(sensitive))) {
            // Check if this is an authorization header and try to parse JWT
            if (lowerKey.includes('authorization') && redactedHeaders[key]) {
                const claims = parseJWTClaims(redactedHeaders[key]);
                if (claims) {
                    // Add JWT claims as token.* attributes
                    for (const [claimKey, claimValue] of Object.entries(claims)) {
                        if (typeof claimValue === 'string' || typeof claimValue === 'number' || typeof claimValue === 'boolean') {
                            jwtClaims[`token.${claimKey}`] = String(claimValue);
                        }
                    }
                }
            }
            redactedHeaders[key] = '[REDACTED]';
        }
    }
    
    return { redactedHeaders, jwtClaims };
}

interface UndiciRequest {
    origin: string;
    method: string;
    path: string;
    headers: string | (string | string[])[];
    addHeader: (name: string, value: string) => void;
    throwOnError: boolean;
    completed: boolean;
    aborted: boolean;
    idempotent: boolean;
    contentLength: number | null;
    contentType: string | null;
    body: any;
}

interface UndiciResponse {
    headers: Buffer[];
    statusCode: number;
    statusText: string;
}

interface EnhancedUndiciInstrumentationConfig extends UndiciInstrumentationConfig {
    captureRequestBody?: boolean;
    captureResponseBody?: boolean;
    captureHeaders?: boolean;
    maxBodySize?: number;
}

// Global map to track response bodies (cleanup needed)
const responseBodyMap = new WeakMap();

/**
 * Enhanced Undici Instrumentation that captures request/response payloads
 * similar to BetterHttpInstrumentation but for undici/fetch requests
 */
export class EnhancedUndiciInstrumentation extends UndiciInstrumentation {
    private options: EnhancedUndiciInstrumentationConfig;

    constructor(options: EnhancedUndiciInstrumentationConfig = {}) {
        const enhancedOptions = {
            ...options,
            requestHook: (span: Span, request: UndiciRequest) => {
                this.enhancedRequestHook(span, request);
                if (options.requestHook) {
                    options.requestHook(span, request);
                }
            },
            responseHook: (span: Span, info: { request: UndiciRequest; response: UndiciResponse }) => {
                this.enhancedResponseHook(span, info);
                if (options.responseHook) {
                    options.responseHook(span, info);
                }
            }
        };

        super(enhancedOptions);
        this.options = {
            captureRequestBody: true,
            captureResponseBody: true,
            captureHeaders: true,
            maxBodySize: 10000, // 10KB limit
            ...options
        };
        
    }

    private enhancedRequestHook(span: Span, request: UndiciRequest) {
        try {

            // Add Kubiks resource attributes
            span.setAttributes({
                'kubiks.otel.source': 'otel-nextjs',
                'kubiks.otel.version': getPackageVersion(),
                'kubiks.otel.instrumentation': 'enhanced-undici',
            });

            // Capture headers
            if (this.options.captureHeaders) {
                const headers = this.extractHeaders(request.headers);
                if (headers && Object.keys(headers).length > 0) {
                    const { redactedHeaders, jwtClaims } = redactSensitiveHeaders(headers);
                    span.setAttributes(flatten({ request: { headers: redactedHeaders } }));
                    // Add JWT claims as span attributes
                    if (Object.keys(jwtClaims).length > 0) {
                        span.setAttributes(jwtClaims);
                    }
                }
            }

            // Capture request body (for POST, PUT, PATCH requests)
            if (this.options.captureRequestBody && request.body) {
                const contentType = request.contentType || this.getContentTypeFromHeaders(request.headers);
                if (this.shouldCaptureBody(contentType, request.body)) {
                    const bodyData = this.parseBody(request.body, contentType);
                    if (bodyData !== null) {
                        span.setAttribute('request.body', typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
                    }
                }
            } else if (request.method !== 'GET' && request.method !== 'HEAD') {
            }

            // Add content type and length as attributes
            if (request.contentType) {
                span.setAttribute('http.request.content_type', request.contentType);
            }
            if (request.contentLength !== null) {
                span.setAttribute('http.request.content_length', request.contentLength);
            }

        } catch (error) {
            // Silently fail to avoid breaking the request
        }
    }

    private enhancedResponseHook(span: Span, info: { request: UndiciRequest; response: UndiciResponse }) {
        try {

            // Capture response headers
            if (this.options.captureHeaders && info.response.headers) {
                const headers = this.extractResponseHeaders(info.response.headers);
                if (headers && Object.keys(headers).length > 0) {
                    const { redactedHeaders, jwtClaims } = redactSensitiveHeaders(headers);
                    span.setAttributes(flatten({ response: { headers: redactedHeaders } }));
                    // Add JWT claims as span attributes (for response headers like set-cookie with JWT)
                    if (Object.keys(jwtClaims).length > 0) {
                        span.setAttributes(jwtClaims);
                    }
                    
                    // Check if this response has a body we could potentially capture
                    const contentType = headers['content-type'];
                    const contentLength = headers['content-length'];
                    
                    if (contentType && contentLength && this.options.captureResponseBody) {
                        
                        // Add metadata about the response body that we detected but couldn't capture
                        span.setAttribute('response.body.detected', true);
                        span.setAttribute('response.body.content_type', contentType);
                        if (contentLength) {
                            span.setAttribute('response.body.content_length', parseInt(contentLength, 10));
                        }
                        span.setAttribute('response.body.capture_limitation', 'undici_stream_not_intercepted');
                    }
                }
            }

            // Add response status and content info
            span.setAttribute('http.response.status_code', info.response.statusCode);
            span.setAttribute('http.response.status_text', info.response.statusText || '');

        } catch (error) {
        }
    }

    private extractHeaders(headers: string | (string | string[])[]): Record<string, string> {
        const headerObj: Record<string, string> = {};

        try {
            if (typeof headers === 'string') {
                // Parse v5 format: "name: value\r\n"
                const lines = headers.split('\r\n');
                for (const line of lines) {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex > 0) {
                        const name = line.substring(0, colonIndex).trim().toLowerCase();
                        const value = line.substring(colonIndex + 1).trim();
                        headerObj[name] = value;
                    }
                }
            } else if (Array.isArray(headers)) {
                // Parse v6 format: [key1, value1, key2, value2]
                for (let i = 0; i < headers.length; i += 2) {
                    const name = String(headers[i]).toLowerCase();
                    const value = Array.isArray(headers[i + 1]) 
                        ? (headers[i + 1] as string[]).join(', ')
                        : String(headers[i + 1]);
                    headerObj[name] = value;
                }
            }
        } catch (error) {
        }

        return headerObj;
    }

    private extractResponseHeaders(headers: Buffer[]): Record<string, string> {
        const headerObj: Record<string, string> = {};
        
        try {
            for (let i = 0; i < headers.length; i += 2) {
                const name = headers[i]?.toString('utf8').toLowerCase();
                const value = headers[i + 1]?.toString('utf8');
                if (name && value) {
                    headerObj[name] = value;
                }
            }
        } catch (error) {
        }

        return headerObj;
    }

    private getContentTypeFromHeaders(headers: string | (string | string[])[]): string | null {
        const headerObj = this.extractHeaders(headers);
        return headerObj['content-type'] || null;
    }

    private shouldCaptureBody(contentType: string | null, body: any): boolean {
        if (!body) return false;

        // Don't capture binary content types
        const binaryTypes = [
            'image/',
            'video/',
            'audio/',
            'application/octet-stream',
            'application/pdf',
            'application/zip',
            'multipart/form-data', // File uploads
        ];

        if (contentType) {
            for (const binaryType of binaryTypes) {
                if (contentType.toLowerCase().includes(binaryType)) {
                    return false;
                }
            }
        }

        // Check if body looks like binary data
        if (Buffer.isBuffer(body)) {
            // Simple heuristic: if more than 30% of bytes are non-printable, consider it binary
            const nonPrintableCount = Array.from(body).filter(byte => 
                byte < 32 && byte !== 9 && byte !== 10 && byte !== 13
            ).length;
            
            if (nonPrintableCount / body.length > 0.3) {
                return false;
            }
        }

        // Check size limit
        const bodySize = this.getBodySize(body);
        if (bodySize > (this.options.maxBodySize || 10000)) {
            return false;
        }

        return true;
    }

    private getBodySize(body: any): number {
        if (Buffer.isBuffer(body)) {
            return body.length;
        }
        if (typeof body === 'string') {
            return Buffer.byteLength(body, 'utf8');
        }
        if (body && typeof body === 'object') {
            return Buffer.byteLength(JSON.stringify(body), 'utf8');
        }
        return 0;
    }

    private parseBody(body: any, contentType: string | null): any {
        try {
            if (!body) return null;

            // If it's already an object, return as-is
            if (typeof body === 'object' && !Buffer.isBuffer(body) && body.constructor === Object) {
                return body;
            }

            // Convert Buffer to string
            const bodyString = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);

            if (!contentType) {
                // Try to parse as JSON first, then return as string
                try {
                    return JSON.parse(bodyString);
                } catch {
                    return bodyString;
                }
            }

            const lowerContentType = contentType.toLowerCase();

            if (lowerContentType.includes('application/json') || lowerContentType.includes('application/x-amz-json')) {
                return JSON.parse(bodyString);
            } else if (lowerContentType.includes('application/x-www-form-urlencoded')) {
                return parse(bodyString);
            } else if (lowerContentType.includes('text/')) {
                return bodyString;
            } else {
                // For other content types, try JSON first, then string
                try {
                    return JSON.parse(bodyString);
                } catch {
                    return bodyString;
                }
            }
        } catch (error) {
            // If parsing fails, return the raw body as string if possible
            try {
                return Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
            } catch {
                return null;
            }
        }
    }
}

export { EnhancedUndiciInstrumentationConfig };