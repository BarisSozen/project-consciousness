/**
 * Escalator Tests
 */

import { describe, it, expect } from 'vitest';
import { Escalator } from '../src/orchestrator/escalator.js';
import type { EvaluationResult } from '../src/types/index.js';

describe('Escalator', () => {
  const escalator = new Escalator();

  const makeEval = (overrides: Partial<EvaluationResult> = {}): EvaluationResult => ({
    taskId: 'T001',
    consistencyScore: 0.9,
    qualityScore: 0.9,
    missionAlignment: 0.9,
    issues: [],
    verdict: 'accept',
    ...overrides,
  });

  it('should not escalate accepted evaluations', () => {
    const result = makeEval({ verdict: 'accept' });
    expect(escalator.shouldEscalate(result)).toBe(false);
  });

  it('should escalate when verdict is escalate', () => {
    const result = makeEval({ verdict: 'escalate' });
    expect(escalator.shouldEscalate(result)).toBe(true);
  });

  it('should create escalation request with correct urgency', () => {
    const result = makeEval({
      verdict: 'escalate',
      consistencyScore: 0.2,
      issues: [
        { severity: 'critical', category: 'mission-drift', description: 'Drifted from mission' },
      ],
    });

    const escalation = escalator.createEscalation(result);
    expect(escalation.urgency).toBe('blocking');
    expect(escalation.taskId).toBe('T001');
    expect(escalation.options.length).toBeGreaterThan(2);
  });

  it('should include scope-creep option when relevant', () => {
    const result = makeEval({
      verdict: 'escalate',
      issues: [
        { severity: 'warning', category: 'scope-creep', description: 'Out of scope' },
      ],
    });

    const escalation = escalator.createEscalation(result);
    const hasOption = escalation.options.some(o => o.includes('Kapsamı daralt'));
    expect(hasOption).toBe(true);
  });

  it('should format escalation for human readability', () => {
    const result = makeEval({
      verdict: 'escalate',
      consistencyScore: 0.3,
      issues: [
        { severity: 'critical', category: 'architecture-violation', description: 'Violated arch' },
      ],
    });

    const escalation = escalator.createEscalation(result);
    const formatted = escalator.formatForHuman(escalation);
    
    expect(formatted).toContain('ESCALATION');
    expect(formatted).toContain('T001');
    expect(formatted).toContain('1.');
  });
});
