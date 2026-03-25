import { describe, it, expect } from 'vitest';
import { BriefValidator } from '../src/brief/brief-validator.js';

describe('BriefValidator', () => {
  const validator = new BriefValidator(70);

  describe('detectGaps', () => {
    it('should detect missing entities in vague brief', () => {
      const gaps = validator.detectGaps('Build something cool');
      const entityGap = gaps.find(g => g.category === 'entity');
      expect(entityGap).toBeDefined();
      expect(entityGap!.importance).toBe('critical');
    });

    it('should not flag entities when they are present', () => {
      const gaps = validator.detectGaps('Build a User management API with CRUD endpoints');
      const entityGap = gaps.find(g => g.category === 'entity');
      expect(entityGap).toBeUndefined();
    });

    it('should detect missing relationships for multi-entity briefs', () => {
      const gaps = validator.detectGaps('Build an API with User and Order entities');
      const relGap = gaps.find(g => g.category === 'relationship');
      expect(relGap).toBeDefined();
    });

    it('should not flag relationships when specified', () => {
      const gaps = validator.detectGaps('Build an API where each User has many Orders');
      const relGap = gaps.find(g => g.category === 'relationship');
      expect(relGap).toBeUndefined();
    });

    it('should detect missing success criteria', () => {
      const gaps = validator.detectGaps('Build a todo app');
      const criteriaGap = gaps.find(g => g.category === 'success-criteria');
      expect(criteriaGap).toBeDefined();
    });

    it('should not flag criteria when endpoints are specified', () => {
      const gaps = validator.detectGaps('Build a REST API with GET/POST/PUT/DELETE endpoints for User CRUD');
      const criteriaGap = gaps.find(g => g.category === 'success-criteria');
      expect(criteriaGap).toBeUndefined();
    });

    it('should detect missing auth rules when auth is set', () => {
      const gaps = validator.detectGaps('Build a user API', { auth: 'jwt', database: 'postgresql', apiStyle: 'rest', frontend: 'api-only', deployment: 'docker' });
      const authGap = gaps.find(g => g.category === 'auth');
      expect(authGap).toBeDefined();
    });

    it('should detect vague terms', () => {
      const gaps = validator.detectGaps('Uygun kullanıcılar hızlı erişebilmeli');
      const bizGap = gaps.find(g => g.category === 'business-rule');
      expect(bizGap).toBeDefined();
    });
  });

  describe('calculateConfidence', () => {
    it('should give low confidence for vague briefs', () => {
      const gaps = validator.detectGaps('Build something');
      const confidence = validator.calculateConfidence('Build something', gaps);
      expect(confidence).toBeLessThan(50);
    });

    it('should give high confidence for detailed briefs', () => {
      const brief = 'Build a REST API for User and Todo entities. Each User has many Todos. Only admin users can delete. Users should be able to login with JWT and create/read/update/delete their own todos.';
      const gaps = validator.detectGaps(brief);
      const confidence = validator.calculateConfidence(brief, gaps);
      expect(confidence).toBeGreaterThanOrEqual(70);
    });

    it('should penalize critical gaps', () => {
      const briefGood = 'Build a User CRUD API with REST endpoints';
      const briefBad = 'Build something';

      const gapsGood = validator.detectGaps(briefGood);
      const gapsBad = validator.detectGaps(briefBad);

      const confGood = validator.calculateConfidence(briefGood, gapsGood);
      const confBad = validator.calculateConfidence(briefBad, gapsBad);

      expect(confGood).toBeGreaterThan(confBad);
    });
  });
});
