// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createHealthHandler } from './health.ts'
import { HttpError, corsHeaders, jsonLogger, parseAllowedOrigins, readJsonBody, withHttp } from './http.ts'
import { MemoryRepo } from './memory_repo.ts'
import { NOW, memoryLogger } from './test_helpers.ts'

describe('CORS', () => {
  it('parse ALLOWED_ORIGIN (liste, espaces, barre finale)', () => {
    expect(parseAllowedOrigins(' https://a.example/, https://b.example ')).toEqual(['https://a.example', 'https://b.example'])
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })
  it('renvoie l’origine seulement si elle est autorisée', () => {
    const req = (origin: string) => new Request('https://x', { headers: { origin } })
    expect(corsHeaders(req('https://a.example'), ['https://a.example'], ['GET'])['Access-Control-Allow-Origin']).toBe('https://a.example')
    expect(corsHeaders(req('https://evil.example'), ['https://a.example'], ['GET'])['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders(req('https://evil.example'), [], ['GET'])['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders(req('https://any.example'), ['*'], ['GET'])['Access-Control-Allow-Origin']).toBe('*')
  })
  it('ajoute les en-têtes CORS aux réponses et aux erreurs', async () => {
    const h = withHttp('t', ['GET'], { allowedOrigins: ['https://a.example'], logger: memoryLogger() }, async () => {
      throw new HttpError(418, 'teapot', 'détail')
    })
    const res = await h(new Request('https://x', { headers: { origin: 'https://a.example' } }))
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ error: 'teapot', detail: 'détail' })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.example')
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('readJsonBody', () => {
  const req = (body: BodyInit, headers: Record<string, string> = {}) => new Request('https://x', { method: 'POST', body, headers })
  it('lit un JSON valide', async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({ a: 1 })
  })
  it('refuse UTF-8 invalide', async () => {
    await expect(readJsonBody(req(new Uint8Array([0x7b, 0xff, 0x7d])), 100)).rejects.toMatchObject({ status: 400 })
  })
  it('refuse un Content-Length déclaré trop grand sans lire le corps', async () => {
    await expect(readJsonBody(req('{}', { 'content-length': '1000' }), 100)).rejects.toMatchObject({ status: 413 })
  })
  it('accepte exactement la limite', async () => {
    const body = JSON.stringify({ p: 'x'.repeat(92) }) // 100 octets
    expect(body.length).toBe(100)
    await expect(readJsonBody(req(body), 100)).resolves.toBeTruthy()
    await expect(readJsonBody(req(body + ' '), 100)).rejects.toMatchObject({ status: 413 })
  })
})

describe('journalisation', () => {
  it('jsonLogger écrit une ligne JSON', () => {
    const lines: string[] = []
    jsonLogger({ app: 'haccp' }, (l) => lines.push(l)).log('info', 'evt', { n: 1 })
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', event: 'evt', app: 'haccp', n: 1 })
  })
  it('chaque requête est journalisée avec fonction, statut et request_id', async () => {
    const logger = memoryLogger()
    const h = withHttp('t', ['GET'], { allowedOrigins: [], logger, newRequestId: () => 'rid-1' }, async () => new Response('{}'))
    const res = await h(new Request('https://x'))
    expect(res.headers.get('x-request-id')).toBe('rid-1')
    expect(logger.lines.at(-1)).toMatchObject({ event: 'request', fields: { fn: 't', request_id: 'rid-1', status: 200, method: 'GET' } })
  })
})

describe('health', () => {
  it('renvoie { ok: true, time }', async () => {
    const h = createHealthHandler({ repo: new MemoryRepo(), logger: memoryLogger(), allowedOrigins: [], now: () => NOW })
    const res = await h(new Request('https://x/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, time: NOW.toISOString() })
  })
  it('503 si la base ne répond pas, sans détail interne', async () => {
    const repo = new MemoryRepo()
    repo.pingFails = true
    const h = createHealthHandler({ repo, logger: memoryLogger(), allowedOrigins: [], now: () => NOW })
    const res = await h(new Request('https://x/health'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, time: NOW.toISOString(), error: 'db_unavailable' })
  })
})
