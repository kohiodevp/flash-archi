// ===========================================================
// Flash-Archi SaaS — Schémas (port des schemas zod du plugin)
// ===========================================================
import { z } from 'zod'

export const FlashSpec = z.object({
  surface: z.number().positive().describe('Surface totale en m²'),
  rooms: z.number().int().positive().describe('Nombre de chambres'),
  hasOpenKitchen: z.boolean().optional(),
  garage: z.union([z.literal('single'), z.literal('double'), z.literal('none')]).optional(),
  style: z.string().describe('Ex: méditerranéen, contemporain, provençal...'),
  roof: z.string().optional(),
  facadeColor: z.string().optional(),
  shutterColor: z.string().optional(),
  // Champs BIM de base pour l'homologation
  storeys: z.number().int().positive().default(1).describe("Nombre d'étages"),
  heightPerStorey: z.number().positive().default(3.0).describe('Hauteur par étage en mètres'),
  spaceProgram: z.array(z.object({ name: z.string(), area: z.number().positive() })).optional().describe('Programme spatial optionnel')
})

export const FlashPlan2DOutput = z.object({
  svg: z.string().describe('SVG du plan d’étage (viewBox adapté)'),
  pngBase64: z.string().optional().describe('PNG rasterisé en base64 (facultatif)'),
  scale: z.number().describe('Échelle utilisée (ex: 1/50)'),
  legend: z.string().describe('Légende des symboles'),
})

export const FlashFacadeOutput = z.object({
  north: z.string().describe('PNG base64'),
  south: z.string().describe('PNG base64'),
  east: z.string().describe('PNG base64'),
  west: z.string().describe('PNG base64'),
})

export const FlashArchiResult = z.object({
  spec: FlashSpec,
  plan2d: FlashPlan2DOutput,
  facades: FlashFacadeOutput,
  ifcModel: z.string().optional().describe('Modèle IFC4 encodé en base64 (data URI application/step)'),
  bimMetrics: z.object({
    footprintArea: z.number().positive().describe('Empreinte au sol en m²'),
    grossVolume: z.number().positive().describe('Volume brut en m³'),
    openingCount: z.number().int().nonnegative().describe("Nombre d'ouvertures détectées"),
    roofArea: z.number().positive().describe('Surface de la toiture en m²'),
    totalVolume: z.number().positive().describe('Volume total du bâtiment en m³')
  }).optional().describe('Métriques BIM dérivées (empreinte, volume, ouvertures, toiture)')
})

export const GenerateRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(4000),
})

export const JobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed'])

export const RailwayStatus = z.object({
  api: z.literal('ok'),
  provider: z.string(),
  model: z.string(),
  uptimeSeconds: z.number(),
  version: z.string(),
})