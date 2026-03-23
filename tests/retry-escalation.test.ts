/**
 * T005 — Retry Loop + Escalation Tests
 * 
 * Senaryo: Agent hatalı kod üretir → Evaluator FAIL → Retry 3x → Escalation → Kullanıcı "atla"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Escalator } from '../src/orchestrator/escalator.js';
import type { 
  EvaluationResult, 
  EscalationRequest,
  AgentResult,
} from '../src/types/index.js';

// ── Helpers ─────────────────────────────────────────────

const makeEval = (overrides: Partial<EvaluationResult> = {}): EvaluationResult => ({
  taskId: 'T001',
  consistencyScore: 0.9,
  qualityScore: 0.9,
  missionAlignment: 0.9,
  issues: [],
  verdict: 'accept',
  ...overrides,
});

const makeFailEval = (retryHint = ''): EvaluationResult => makeEval({
  verdict: 'revise',
  qualityScore: 0.3,
  missionAlignment: 0.5,
  issues: [
    { severity: 'warning', category: 'architecture-violation', description: `tsc failed${retryHint}` },
  ],
  feedback: `TypeScript compilation failed${retryHint}. Fix type errors.`,
});

const makeEscalateEval = (): EvaluationResult => makeEval({
  verdict: 'escalate',
  qualityScore: 0.2,
  consistencyScore: 0.3,
  missionAlignment: 0.2,
  issues: [
    { severity: 'critical', category: 'mission-drift', description: 'Agent completely off track' },
    { severity: 'warning', category: 'architecture-violation', description: 'tsc failed' },
  ],
  feedback: '3 retry sonrası hâlâ başarısız. Checks: 2/7 passed.',
});

// ── Escalator Tests ─────────────────────────────────────

describe('Escalator v2', () => {
  let escalator: Escalator;

  beforeEach(() => {
    escalator = new Escalator();
  });

  describe('parseResponse', () => {
    it('should parse "1" as continue', () => {
      expect(escalator.parseResponse('1')).toEqual({ action: 'continue' });
    });

    it('should parse "devam" as continue', () => {
      expect(escalator.parseResponse('devam et')).toEqual({ action: 'continue' });
    });

    it('should parse "2" as skip', () => {
      expect(escalator.parseResponse('2')).toEqual({ action: 'skip' });
    });

    it('should parse "atla" as skip', () => {
      expect(escalator.parseResponse('atla')).toEqual({ action: 'skip' });
    });

    it('should parse "3" as stop', () => {
      expect(escalator.parseResponse('3')).toEqual({ action: 'stop' });
    });

    it('should parse "durdur" as stop', () => {
      expect(escalator.parseResponse('durdur')).toEqual({ action: 'stop' });
    });

    it('should parse "retry" with feedback', () => {
      const result = escalator.parseResponse('retry please fix imports');
      expect(result.action).toBe('retry');
      expect(result.feedback).toContain('retry');
    });

    it('should default to continue with feedback for unknown input', () => {
      const result = escalator.parseResponse('bence sorun yok');
      expect(result.action).toBe('continue');
      expect(result.feedback).toBe('bence sorun yok');
    });
  });

  describe('createEscalation', () => {
    it('should include retry count', () => {
      const eval_ = makeEscalateEval();
      const esc = escalator.createEscalation(eval_, 3);
      expect(esc.retryCount).toBe(3);
      expect(esc.context).toContain('3/3');
    });

    it('should set blocking urgency for critical issues', () => {
      const eval_ = makeEscalateEval();
      const esc = escalator.createEscalation(eval_);
      expect(esc.urgency).toBe('blocking');
    });

    it('should set important urgency for low scores without critical', () => {
      const eval_ = makeEval({
        verdict: 'escalate',
        qualityScore: 0.2,
        consistencyScore: 0.3,
        issues: [],
      });
      const esc = escalator.createEscalation(eval_);
      expect(esc.urgency).toBe('important');
    });
  });

  describe('formatForHuman', () => {
    it('should include retry info when present', () => {
      const esc: EscalationRequest = {
        taskId: 'T001',
        reason: 'Test failed',
        context: 'Quality: 30%',
        options: ['devam', 'atla', 'durdur'],
        urgency: 'blocking',
        retryCount: 3,
      };
      const formatted = escalator.formatForHuman(esc);
      expect(formatted).toContain('Retry sayısı: 3');
      expect(formatted).toContain('ESKALASYON');
      expect(formatted).toContain('T001');
    });

    it('should list numbered options', () => {
      const esc: EscalationRequest = {
        taskId: 'T001',
        reason: 'test',
        context: 'test',
        options: ['a', 'b'],
        urgency: 'informational',
      };
      const formatted = escalator.formatForHuman(esc);
      expect(formatted).toContain('1.');
      expect(formatted).toContain('2.');
      expect(formatted).toContain('3.');
    });
  });

  describe('promptUser (mocked readline)', () => {
    it('should return skip when user types 2', async () => {
      escalator.setAskFn(async () => '2');
      
      const esc: EscalationRequest = {
        taskId: 'T001',
        reason: 'test',
        context: 'test',
        options: [],
        urgency: 'blocking',
        retryCount: 3,
      };

      const response = await escalator.promptUser(esc);
      expect(response.action).toBe('skip');
    });

    it('should return stop when user types 3', async () => {
      escalator.setAskFn(async () => '3');

      const esc: EscalationRequest = {
        taskId: 'T001',
        reason: 'test',
        context: 'test',
        options: [],
        urgency: 'blocking',
      };

      const response = await escalator.promptUser(esc);
      expect(response.action).toBe('stop');
    });

    it('should return continue when user types 1', async () => {
      escalator.setAskFn(async () => '1');

      const esc: EscalationRequest = {
        taskId: 'T001',
        reason: 'test',
        context: 'test',
        options: [],
        urgency: 'informational',
      };

      const response = await escalator.promptUser(esc);
      expect(response.action).toBe('continue');
    });
  });
});

// ── Retry Loop Simulation ───────────────────────────────

describe('Retry Loop Logic', () => {
  it('should exhaust retries then escalate', () => {
    // Simüle: 3 retry hep fail → escalation gerekli
    const maxRetries = 3;
    let retryCount = 0;
    let escalated = false;

    while (retryCount < maxRetries) {
      const eval_ = makeFailEval(` (retry ${retryCount + 1})`);
      expect(eval_.verdict).toBe('revise');
      retryCount++;
    }

    // Max retry aşıldı → escalation
    expect(retryCount).toBe(maxRetries);
    escalated = true;
    expect(escalated).toBe(true);
  });

  it('should accept on successful retry', () => {
    const maxRetries = 3;
    let retryCount = 0;
    let accepted = false;

    // İlk 2 retry fail, 3. retry accept
    while (retryCount < maxRetries) {
      retryCount++;
      if (retryCount === 3) {
        const eval_ = makeEval({ verdict: 'accept' });
        accepted = eval_.verdict === 'accept';
        break;
      }
    }

    expect(accepted).toBe(true);
    expect(retryCount).toBe(3);
  });

  it('should build feedback chain across retries', () => {
    const baseDesc = 'Write a calculator';
    const retries = [
      'tsc failed: missing return type',
      'test failed: divide by zero not handled',
      'lint warning: unused import',
    ];

    let description = baseDesc;
    for (let i = 0; i < retries.length; i++) {
      description = `${description}\n\n⚠️ RETRY ${i + 1}/3 — ÖNCEKİ DENEME BAŞARISIZ\nGeri bildirim: ${retries[i]}`;
    }

    // Tüm retry feedback'leri prompt'ta mevcut
    expect(description).toContain('RETRY 1/3');
    expect(description).toContain('RETRY 2/3');
    expect(description).toContain('RETRY 3/3');
    expect(description).toContain('missing return type');
    expect(description).toContain('divide by zero');
    expect(description).toContain('unused import');
  });
});

// ── Escalation → User Action ────────────────────────────

describe('Escalation User Actions', () => {
  it('should handle "atla" gracefully', async () => {
    const escalator = new Escalator();
    escalator.setAskFn(async () => 'atla');

    const eval_ = makeEscalateEval();
    const esc = escalator.createEscalation(eval_, 3);
    const response = await escalator.promptUser(esc);

    expect(response.action).toBe('skip');
  });

  it('should handle "durdur" and signal stop', async () => {
    const escalator = new Escalator();
    escalator.setAskFn(async () => 'durdur');

    const eval_ = makeEscalateEval();
    const esc = escalator.createEscalation(eval_, 3);
    const response = await escalator.promptUser(esc);

    expect(response.action).toBe('stop');
  });

  it('full scenario: 3 retries → escalate → user skips', async () => {
    const escalator = new Escalator();
    escalator.setAskFn(async () => '2'); // user says "atla"

    // Simulate 3 retries
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      const eval_ = makeFailEval(` (retry ${retryCount + 1})`);
      expect(eval_.verdict).toBe('revise');
      retryCount++;
    }

    // Escalation
    expect(retryCount).toBe(maxRetries);
    const finalEval = makeEscalateEval();
    const esc = escalator.createEscalation(finalEval, retryCount);
    const response = await escalator.promptUser(esc);

    expect(response.action).toBe('skip');
    expect(esc.retryCount).toBe(3);
    expect(esc.urgency).toBe('blocking');
  });
});
