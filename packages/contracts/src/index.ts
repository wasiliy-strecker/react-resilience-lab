import { z } from 'zod'

export const incidentSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
])

export const incidentStatusSchema = z.enum(['open', 'acknowledged', 'resolved'])

export const incidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  service: z.string().min(1),
  summary: z.string().min(1),
  severity: incidentSeveritySchema,
  status: incidentStatusSchema,
  assignee: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  detectedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const incidentListResponseSchema = z.object({
  items: z.array(incidentSchema),
  generatedAt: z.iso.datetime(),
})

const commandFields = {
  commandId: z.uuid(),
  incidentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
}

export const incidentCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...commandFields,
    type: z.literal('acknowledge'),
  }),
  z.object({
    ...commandFields,
    type: z.literal('assign'),
    assignee: z.string().trim().min(1).max(80),
  }),
  z.object({
    ...commandFields,
    type: z.literal('resolve'),
    resolutionNote: z.string().trim().min(1).max(500),
  }),
])

export const incidentCommandResultSchema = z.object({
  incident: incidentSchema,
  replayed: z.boolean(),
})

export const faultProfileSchema = z.enum([
  'normal',
  'slow',
  'flaky',
  'conflict',
])

export const apiProblemSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  requestId: z.string().min(1),
})

export type ApiProblem = z.infer<typeof apiProblemSchema>
export type FaultProfile = z.infer<typeof faultProfileSchema>
export type Incident = z.infer<typeof incidentSchema>
export type IncidentCommand = z.infer<typeof incidentCommandSchema>
export type IncidentCommandResult = z.infer<typeof incidentCommandResultSchema>
export type IncidentListResponse = z.infer<typeof incidentListResponseSchema>
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>
export type IncidentStatus = z.infer<typeof incidentStatusSchema>
export type IncidentVersion = Incident['version']
