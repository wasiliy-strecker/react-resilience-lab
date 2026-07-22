import { describe, expect, it } from 'vitest'

import { DeterministicFaultInjector } from '../src/fault-injector.js'

describe('DeterministicFaultInjector', () => {
  it('uses explicit latency for stable profiles', () => {
    const injector = new DeterministicFaultInjector()

    expect(injector.next('normal', 'read')).toEqual({
      delayMs: 24,
      forceConflict: false,
      reject: false,
    })
    expect(injector.next('slow', 'read').delayMs).toBe(850)
  })

  it('rejects every third flaky request and then recovers', () => {
    const injector = new DeterministicFaultInjector()

    expect(injector.next('flaky', 'read').reject).toBe(false)
    expect(injector.next('flaky', 'read').reject).toBe(false)
    expect(injector.next('flaky', 'read').reject).toBe(true)
    expect(injector.next('flaky', 'read').reject).toBe(false)
  })

  it('forces conflicts only across command boundaries', () => {
    const injector = new DeterministicFaultInjector()

    expect(injector.next('conflict', 'read').forceConflict).toBe(false)
    expect(injector.next('conflict', 'command').forceConflict).toBe(true)
  })
})
