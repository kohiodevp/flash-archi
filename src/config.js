// ===========================================================
// Flash-Archi SaaS — Chargement de configuration
// Fusion : .env (dotenv) + config.yaml + defaults.
// Les variables d'environnement priment sur le YAML.
// ===========================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(ROOT, '.env') })

function readYaml() {
  const file = path.join(ROOT, 'config.yaml')
  if (!fs.existsSync(file)) return { providers: {}, routing: { rules: [] }, cache: {} }
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'))
  } catch {
    return { providers: {}, routing: { rules: [] }, cache: {} }
  }
}

const yamlCfg = readYaml()
const providersYaml = yamlCfg.providers ?? {}
const routingYaml = yamlCfg.routing ?? {}
const cacheYaml = yamlCfg.cache ?? {}

function envStr(name, fallback = '') {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}
const envInt = (name, fallback) => {
  const v = Number(envStr(name, fallback))
  return Number.isFinite(v) ? v : fallback
}

export const config = {
  server: {
    port: envInt('PORT', 8080),
    host: envStr('HOST', '0.0.0.0'),
  },
  db: {
    path: envStr('DB_PATH', path.join(ROOT, 'data', 'flash-archi.db')),
  },
  llm: {
    provider: envStr('LLM_PROVIDER', 'openrouter'),
    model: envStr('LLM_MODEL', providersYaml.providers?.openrouter?.models?.text ?? 'gpt-4o'),
    maxTokens: envInt('LLM_MAX_TOKENS', 1500),
    temperature: Number(envStr('LLM_TEMPERATURE', '0.2')),
  },
  providers: {
    openrouter: {
      baseUrl: envStr('OPENROUTER_BASE_URL', providersYaml.openrouter?.base_url ?? 'https://openrouter.ai/api/v1'),
      apiKey: envStr('OPENROUTER_API_KEY'),
      textModel: envStr('OPENROUTER_MODEL', providersYaml.openrouter?.models?.text ?? 'anthropic/claude-3.5-sonnet'),
      fallback: envStr('OPENROUTER_FALLBACK', providersYaml.openrouter?.fallback ?? 'openai/gpt-4o'),
    },
    groq: {
      baseUrl: envStr('GROQ_BASE_URL', providersYaml.groq?.base_url ?? 'https://api.groq.com/openai/v1'),
      apiKey: envStr('GROQ_API_KEY'),
      textModel: envStr('GROQ_MODEL', providersYaml.groq?.models?.nlp ?? 'llama-3.3-70b-versatile'),
    },
    ollama: {
      baseUrl: envStr('OLLAMA_BASE_URL', providersYaml.ollama?.base_url ?? 'http://localhost:11434'),
      fallbackModel: envStr('OLLAMA_FALLBACK_MODEL', providersYaml.ollama?.models?.fallback_text ?? 'llama3.1:8b'),
    },
    seekai: {
      baseUrl: envStr('SEEKAI_BASE_URL', providersYaml.seekai?.base_url ?? 'https://seekai.cc/v1'),
      apiKey: envStr('SEEKAI_API_KEY'),
      textModel: envStr('SEEKAI_MODEL', providersYaml.seekai?.models?.text ?? 'deepseek-v4-pro'),
      temperature: Number(envStr('SEEKAI_TEMPERATURE', providersYaml.seekai?.models?.temperature ?? 0.7)),
      fallback: envStr('SEEKAI_FALLBACK', providersYaml.seekai?.fallback ?? 'openai/gpt-4o-mini'),
    },
  },
  routing: {
    strategy: envStr('ROUTING_STRATEGY', routingYaml.strategy ?? 'cost_quality_balance'),
    rules: routingYaml.rules ?? [],
  },
  cache: {
    ttlMs: envInt('CACHE_TTL_MS', cacheYaml.ttl_ms ?? 3600000),
    maxEntries: envInt('CACHE_MAX_ENTRIES', cacheYaml.max_entries ?? 500),
  },
}

export const PROJECT_ROOT = ROOT