import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { tracer } from './tracing'

export function initTelemetry(serviceName: string, serviceVersion = '1.0.0'): NodeSDK | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) {
    tracer.info(
      undefined,
      `[otel] telemetry disabled for ${serviceName}; set OTEL_EXPORTER_OTLP_ENDPOINT to enable (OtlpHttp/OTLP, e.g. http://otel-collector:4318)`
    )
    return null
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'dev',
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? Object.fromEntries(
            process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((pair) => {
              const [k, ...rest] = pair.split('=')
              return [k.trim(), rest.join('=').trim()]
            })
          )
        : {},
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  })

  sdk.start()
  tracer.info(undefined, `[otel] OpenTelemetry tracing started for ${serviceName} -> ${endpoint}`)
  return sdk
}