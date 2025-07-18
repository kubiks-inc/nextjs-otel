import { Span } from "@opentelemetry/api";
import { ClientRequest, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "http";
import { HttpPlugin } from "./http-plugins/plugin.ts";
import { flatten } from "flat";
import { HttpInstrumentation } from "./http/index.ts";
import { HttpInstrumentationConfig } from "./http/types.ts"
import { parse } from 'querystring'
import { PassThrough } from "stream";

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
function redactSensitiveHeaders(headers: Record<string, any>): { redactedHeaders: Record<string, any>, jwtClaims: Record<string, any> } {
    const redactedHeaders = { ...headers };
    let jwtClaims: Record<string, any> = {};
    
    for (const key in redactedHeaders) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_HEADERS.some(sensitive => lowerKey.includes(sensitive))) {
            // Check if this is an authorization header and try to parse JWT
            if (lowerKey.includes('authorization') && redactedHeaders[key]) {
                const claims = parseJWTClaims(String(redactedHeaders[key]));
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

export type BetterHttpInstrumentationOptions = {
    plugins?: HttpPlugin[],
    captureBody?: boolean,
    captureHeaders?: boolean,
    requestHook?: HttpInstrumentationConfig['requestHook']
    responseHook?: HttpInstrumentationConfig['responseHook']
    ignoreIncomingRequestHook?: HttpInstrumentationConfig['ignoreIncomingRequestHook']
    ignoreOutgoingRequestHook?: HttpInstrumentationConfig['ignoreOutgoingRequestHook']
    startIncomingSpanHook?: HttpInstrumentationConfig['startIncomingSpanHook']
    startOutgoingSpanHook?: HttpInstrumentationConfig['startOutgoingSpanHook']
    includeUndiciInstrumentation?: boolean
    requireParentforOutgoingSpans?: boolean
    requireParentforIncomingSpans?: boolean
}

export function _betterHttpInstrumentation(options: BetterHttpInstrumentationOptions = {}) {
    options.plugins = options.plugins || [];
    return {
        requestHook(span: Span, request: ClientRequest | IncomingMessage) {
            // Add Kubiks resource attributes to all HTTP spans
            span.setAttributes({
                'kubiks.otel.source': 'otel-nextjs',
                'kubiks.otel.version': '1.0.11',
                'kubiks.otel.instrumentation': 'better-http',
            });

            if (request instanceof ClientRequest) {
                const plugin = options.plugins.find(plugin => plugin?.shouldParseRequest(request)) as HttpPlugin | undefined;

                if (plugin) {
                    span.setAttribute('http.plugin.name', plugin.name);

                    const headers = request.getHeaders();


                    if (options.captureHeaders) {
                        const { redactedHeaders, jwtClaims } = redactSensitiveHeaders(headers);
                        span.setAttributes(flatten({ request: { headers: redactedHeaders } }));
                        // Add JWT claims as span attributes
                        if (Object.keys(jwtClaims).length > 0) {
                            span.setAttributes(jwtClaims);
                        }
                    }
                    if (plugin.captureBody) {
                        getClientRequestBody(request, (body) => {
                            const requestData = _parseBodySafe(body, headers);
                            span.setAttribute('request.body', typeof requestData === 'string' ? requestData : JSON.stringify(requestData));
                        })
                    }
                } else {

                    const headers = request.getHeaders();


                    if (options.captureHeaders) {
                        const { redactedHeaders, jwtClaims } = redactSensitiveHeaders(headers);
                        span.setAttributes(flatten({ request: { headers: redactedHeaders } }));
                        // Add JWT claims as span attributes
                        if (Object.keys(jwtClaims).length > 0) {
                            span.setAttributes(jwtClaims);
                        }
                    }

                    if (options.captureBody && shouldCaptureBody(request.host)) {
                        getClientRequestBody(request, (body) => {
                            const requestData = _parseBodySafe(body, headers);
                            span.setAttribute('request.body', typeof requestData === 'string' ? requestData : JSON.stringify(requestData));
                        })

                    }
                }

            }
            if (request instanceof IncomingMessage) {
                const plugin = options.plugins.find(plugin => plugin.shouldParseRequest && plugin.shouldParseRequest(request));

                span.setAttribute('http.plugin.name', plugin.name);

                if (plugin.parseIncommingMessage) {
                    const attributes = plugin.parseIncommingMessage(request);
                    span.setAttributes(flatten(attributes));
                }
            }

            if (options.requestHook) {
                options.requestHook(span, request);
            }
        },
        responseHook(span: Span, response: IncomingMessage | ServerResponse, cb: () => void) {
            if (response instanceof IncomingMessage) {
                try {
                    const headers = response.headers;
                    if (options.captureHeaders) {
                        const { redactedHeaders, jwtClaims } = redactSensitiveHeaders(headers);
                        span.setAttributes(flatten({ response: { headers: redactedHeaders } }));
                        // Add JWT claims as span attributes (for response headers like set-cookie with JWT)
                        if (Object.keys(jwtClaims).length > 0) {
                            span.setAttributes(jwtClaims);
                        }
                    }


                    if (options.captureBody && shouldCaptureBody(response.url || '')) {
                        getClientResponseBody(response, (body) => {
                            const responseData = _parseBodySafe(body, headers);
                            span.setAttribute('response.body', typeof responseData === 'string' ? responseData : JSON.stringify(responseData));
                            cb();
                        })
                    } else {
                        cb();
                    }
                } catch (e) {
                    cb();
                }
            }

            if (options.responseHook) {
                options.responseHook(span, response, cb);
            }

        },
    }
}

const ignoredHosts = [
    'localhost',
    'otlp.kubiks.ai',
];

function getClientRequestBody(r: ClientRequest, cb: (body: string) => void) {
    const chunks: Buffer[] = [];
    const oldWrite = r.write.bind(r);
    r.write = (data: Buffer | string) => {
        try {
            if (typeof data === 'string') {
                chunks.push(Buffer.from(data));

                if (data[data.length - 1] === '}') {
                    const body = Buffer.concat(chunks).toString('utf8');
                    cb(body);
                }
            } else {
                chunks.push(data);

                if (data[data.length - 1] === 125) {
                    const body = Buffer.concat(chunks).toString('utf8');
                    cb(body);
                }
            }
        } catch (e) {
        }
        return oldWrite(data);
    };
    const oldEnd = r.end.bind(r);
    r.end = (data: any) => {
        try {
            if (data) {
                if (typeof data === 'string') {
                    chunks.push(Buffer.from(data));
                } else {
                    chunks.push(data);
                }
            }
            if (chunks.length > 0) {
                const body = Buffer.concat(chunks).toString('utf8');
                cb(body);
            }
        } catch (e) {
        }
        return oldEnd(data);
    };
};

function getClientResponseBody(r: IncomingMessage, cb: (body: string) => void) {
    const chunks: Buffer[] = [];
    const pt = new PassThrough();

    pt.on('data', (chunk) => {
        try {
            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk));
            } else {
                chunks.push(chunk);
            }
        } catch (e) {
        }
    }).on('end', () => {
        try {
            if (chunks.length > 0) {
                const body = Buffer.concat(chunks).toString('utf8');
                cb(body)
            }
        } catch (e) {
        }
    });

    const originalState = r.readableFlowing;
    r.pipe(pt);
    // @ts-ignore
    r.readableFlowing = originalState;
}

function shouldCaptureBody(host: string) {
    return !ignoredHosts.find(ignoredHost => host.includes(ignoredHost));
}

function _parseBodySafe(body: string, headers: OutgoingHttpHeaders): unknown {
    let requestData: unknown = body;
    try {
        if (headers['content-type'] && typeof headers['content-type'] === 'string') {
            if (headers['content-type'].includes('application/json') || headers['content-type'].includes('application/x-amz-json')) {
                requestData = JSON.parse(body);
            } else if (headers['content-type'].includes('application/x-www-form-urlencoded')) {
                requestData = parse(body);
            }
        }
    } catch (_) {
    }

    return requestData;
}

export class BetterHttpInstrumentation extends HttpInstrumentation {
    constructor(options: BetterHttpInstrumentationOptions = {}) {
        super({
            ..._betterHttpInstrumentation(options),
            ignoreIncomingRequestHook: options.ignoreIncomingRequestHook,
            ignoreOutgoingRequestHook: options.ignoreOutgoingRequestHook,
            startIncomingSpanHook: options.startIncomingSpanHook,
            startOutgoingSpanHook: options.startOutgoingSpanHook,
            requireParentforOutgoingSpans: options.requireParentforOutgoingSpans,
            requireParentforIncomingSpans: options.requireParentforIncomingSpans,
        })
    }
}