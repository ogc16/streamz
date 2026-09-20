{{- define "streamz.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "streamz.fullname" -}}
{{- printf "%s-%s" .Release.Name "streamz" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "streamz.labels" -}}
app.kubernetes.io/name: {{ include "streamz.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: streamz
{{- end }}

{{- define "streamz.serviceEnv" -}}
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "streamz.fullname" . }}-secrets
      key: JWT_SECRET
{{- end }}