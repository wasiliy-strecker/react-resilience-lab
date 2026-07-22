import type { FaultProfile } from '@react-resilience/contracts'

export type FaultOperation = 'read' | 'command'

export interface FaultDecision {
  delayMs: number
  forceConflict: boolean
  reject: boolean
}

export interface FaultInjector {
  next(profile: FaultProfile, operation: FaultOperation): FaultDecision
}

export class DeterministicFaultInjector implements FaultInjector {
  readonly #attempts = new Map<FaultProfile, number>()

  next(profile: FaultProfile, operation: FaultOperation): FaultDecision {
    const attempt = (this.#attempts.get(profile) ?? 0) + 1
    this.#attempts.set(profile, attempt)

    switch (profile) {
      case 'normal':
        return { delayMs: 24, forceConflict: false, reject: false }
      case 'slow':
        return { delayMs: 850, forceConflict: false, reject: false }
      case 'flaky':
        return {
          delayMs: 120,
          forceConflict: false,
          reject: attempt % 3 === 0,
        }
      case 'conflict':
        return {
          delayMs: 80,
          forceConflict: operation === 'command',
          reject: false,
        }
    }
  }
}
