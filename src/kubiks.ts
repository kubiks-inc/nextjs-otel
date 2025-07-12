import { BatchSpanProcessor, NodeTracerProvider, SimpleSpanProcessor, Sampler, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import api, { Attributes, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { DetectorSync, detectResourcesSync, Resource, ResourceAttributes } from '@opentelemetry/resources';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws'
import { VercelDetector } from './resources/vercel.ts';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { InstrumentationOption, registerInstrumentations } from '@opentelemetry/instrumentation';
import { ServiceDetector } from './resources/service.ts';
import { KoyebDetector } from './resources/koyeb.ts';

type KubiksSDKOpts = {
    instrumentations?: InstrumentationOption[],
    collectorUrl?: string,
    kubiksKey?: string,
    service?: string,
    log?: boolean,
    namespace?: string,
    serverless?: boolean
    sampler?: Sampler
    resourceDetectors?: DetectorSync[],
    resourceAttributes?: Resource | Attributes
}


/**
 * KubiksSDK is a wrapper around the OpenTelemetry NodeSDK that configures it to send traces to Kubiks.
 * 
 * @param {InstrumentationOption[]} options.instrumentations - The OpenTelemetry instrumentations to enable.
 * @param {string} options.kubiksKey - The Kubiks API key. Defaults to the KUBIKS_KEY environment variable.
 * @param {string} options.service - The name of the service. 
 * @param {string} options.namespace - The namespace of the service.
 * @param {boolean} options.serverless - Whether or not the service is running in a serverless environment. Defaults to false.
 * @param {boolean} options.log - Whether or not to enable the log exporter. Defaults to false.
 * @param {string} options.collectorUrl - The URL of the Kubiks collector. Defaults to https://otlp.kubiks.ai/v1
 * @param {Sampler} options.sampler - The OpenTelemetry sampler to use. Defaults to No Sampling.
 */
export class KubiksSDK {
    options: KubiksSDKOpts;
    attributes: ResourceAttributes;
    constructor(options: KubiksSDKOpts) {
        options.serverless = options.serverless || false;
        options.collectorUrl = options.collectorUrl || process.env.COLLECTOR_URL || "https://otlp.kubiks.ai";
        options.kubiksKey = options.kubiksKey || process.env.KUBIKS_API_KEY || process.env.KUBIKS_KEY

        this.options = options;
    }

    start() {
        if (process.env.OTEL_LOG_LEVEL === "debug") {
            api.diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);
        }
        const provider = new NodeTracerProvider({
            sampler: this.options.sampler,
            resource: detectResourcesSync({
                detectors: [
                    awsLambdaDetector,
                    new VercelDetector(),
                    new KoyebDetector(),
                    ...(this.options.resourceDetectors || []),
                    new ServiceDetector({ serviceName: this.options.service, attributes: this.options.resourceAttributes })
                ],
            }),
            forceFlushTimeoutMillis: 5000,
        });



        // configure exporters

        let exporter: OTLPTraceExporter | ConsoleSpanExporter | undefined = undefined;

        if (!this.options.kubiksKey) {
            console.warn("No Kubiks API key provided. Traces will not be sent to Kubiks.")
        }


        if (this.options.kubiksKey) {
            let collectorUrl = this.options.collectorUrl;

            exporter = new OTLPTraceExporter({
                url: collectorUrl + "/v1/traces",
                headers: {
                    "X-Kubiks-Key": this.options.kubiksKey || process.env.KUBIKS_KEY || process.env.KUBIKS_OTEL_KEY,
                },
                timeoutMillis: 1000,
            });
        }

        if (this.options.log) {
            exporter = new ConsoleSpanExporter();
        }

        if (exporter) {
            const spanProcessor = this.options.serverless ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter, {
                maxQueueSize: 100,
                maxExportBatchSize: 5,
            });


            provider.addSpanProcessor(spanProcessor);
        }

        provider.register();

        registerInstrumentations({
            instrumentations: [
                ...this.options.instrumentations || []
            ]
        });
        return provider;
    }
}