/**
 * SmartBrief Tests
 *
 * "URL shortener istiyorum, kayıt olsun, link tıklanınca redirect olsun, linkler süresi dolmasın"
 * → doğru soruları soruyor mu?
 * → doğru kararları alıyor mu?
 * → özet anlaşılır mı?
 */

import { describe, it, expect } from 'vitest';
import { SmartBrief } from '../src/brief/smart-brief.js';

describe('SmartBrief', () => {
  // ── ADIM 2: analyzeBrief ────────────────────────────────

  describe('analyzeBrief', () => {
    const sb = new SmartBrief();

    it('should auto-detect JWT auth when user registration mentioned', () => {
      const analysis = sb.analyzeBrief('URL shortener istiyorum, kayıt olsun');
      const authDecision = analysis.autoDecisions.find(d => d.key === 'auth');
      expect(authDecision).toBeDefined();
      expect(authDecision!.value).toBe('jwt');
    });

    it('should auto-detect REST API for endpoint tasks', () => {
      const analysis = sb.analyzeBrief('REST API yaz, CRUD endpoint olsun');
      const apiDecision = analysis.autoDecisions.find(d => d.key === 'apiStyle');
      expect(apiDecision).toBeDefined();
      expect(apiDecision!.value).toBe('rest');
    });

    it('should auto-detect SQLite as default DB', () => {
      const analysis = sb.analyzeBrief('basit bir todo app yap');
      const dbDecision = analysis.autoDecisions.find(d => d.key === 'database');
      expect(dbDecision).toBeDefined();
      expect(dbDecision!.value).toBe('sqlite');
    });

    it('should detect PostgreSQL when mentioned', () => {
      const analysis = sb.analyzeBrief('postgresql ile bir user management sistemi');
      const dbDecision = analysis.autoDecisions.find(d => d.key === 'database');
      expect(dbDecision).toBeDefined();
      expect(dbDecision!.value).toBe('postgresql');
    });

    it('should detect React frontend when mentioned', () => {
      const analysis = sb.analyzeBrief('React ile dashboard yap');
      const feDecision = analysis.autoDecisions.find(d => d.key === 'frontend');
      expect(feDecision).toBeDefined();
      expect(feDecision!.value).toBe('react');
    });

    it('should default to api-only when no frontend mentioned', () => {
      const analysis = sb.analyzeBrief('basit bir API endpoint yaz');
      const feDecision = analysis.autoDecisions.find(d => d.key === 'frontend');
      expect(feDecision).toBeDefined();
      expect(feDecision!.value).toBe('api-only');
    });

    it('should set auth=none when no user/login keywords', () => {
      const analysis = sb.analyzeBrief('basit bir hesap makinesi API');
      const authDecision = analysis.autoDecisions.find(d => d.key === 'auth');
      expect(authDecision).toBeDefined();
      expect(authDecision!.value).toBe('none');
    });

    it('should have all 5 architecture decisions', () => {
      const analysis = sb.analyzeBrief('herhangi bir proje');
      const keys = analysis.autoDecisions.map(d => d.key);
      expect(keys).toContain('auth');
      expect(keys).toContain('database');
      expect(keys).toContain('apiStyle');
      expect(keys).toContain('frontend');
      expect(keys).toContain('deployment');
    });
  });

  // ── ADIM 2b: Belirsiz ürün soruları ────────────────────

  describe('uncertainQuestions', () => {
    const sb = new SmartBrief();

    it('should ask link access + expiry for URL shortener', () => {
      const analysis = sb.analyzeBrief(
        'URL shortener istiyorum, kayıt olsun, link tıklanınca redirect olsun'
      );

      const questionIds = analysis.uncertainQuestions.map(q => q.id);
      expect(questionIds).toContain('link-access');
      expect(questionIds).toContain('link-expiry');
    });

    it('should ask user visibility when registration mentioned', () => {
      const analysis = sb.analyzeBrief(
        'kullanıcı kayıt sistemi, profil sayfası olsun'
      );

      const questionIds = analysis.uncertainQuestions.map(q => q.id);
      expect(questionIds).toContain('user-visibility');
    });

    it('should ask monetization when payment keywords present', () => {
      const analysis = sb.analyzeBrief('premium abonelik sistemi olan bir SaaS');

      const questionIds = analysis.uncertainQuestions.map(q => q.id);
      expect(questionIds).toContain('monetization');
    });

    it('should ask api-scope when frontend unclear', () => {
      const analysis = sb.analyzeBrief('backend API yaz');

      const questionIds = analysis.uncertainQuestions.map(q => q.id);
      expect(questionIds).toContain('api-scope');
    });

    it('should NOT ask api-scope when frontend is explicit', () => {
      const analysis = sb.analyzeBrief('React ile frontend yap, API de olsun');

      const questionIds = analysis.uncertainQuestions.map(q => q.id);
      expect(questionIds).not.toContain('api-scope');
    });

    it('should limit to max 4 questions', () => {
      // Mümkün olduğunca çok trigger
      const analysis = sb.analyzeBrief(
        'URL shortener, kullanıcı kayıt, ödeme sistemi, dosya upload, API endpoint'
      );

      expect(analysis.uncertainQuestions.length).toBeLessThanOrEqual(4);
    });

    it('should not ask questions for simple brief', () => {
      const analysis = sb.analyzeBrief('hesap makinesi yap');

      expect(analysis.uncertainQuestions.length).toBe(0);
    });
  });

  // ── ADIM 3: askClarifications ───────────────────────────

  describe('askClarifications', () => {
    it('should use defaults when enter pressed (empty answer)', async () => {
      const sb = new SmartBrief();
      let callCount = 0;
      sb.setAskFn(async () => {
        callCount++;
        return ''; // enter = default
      });

      const questions = [
        {
          id: 'test-q',
          question: 'Test?',
          options: ['A', 'B', 'C'],
          defaultAnswer: 'B',
          category: 'access' as const,
        },
      ];

      const answers = await sb.askClarifications(questions);
      expect(answers).toHaveLength(1);
      expect(answers[0]!.answer).toBe('B'); // default
      expect(callCount).toBe(1);
    });

    it('should accept numeric selection', async () => {
      const sb = new SmartBrief();
      sb.setAskFn(async () => '2');

      const questions = [
        {
          id: 'test-q',
          question: 'Test?',
          options: ['Evet', 'Hayır', 'Belki'],
          defaultAnswer: 'Evet',
          category: 'access' as const,
        },
      ];

      const answers = await sb.askClarifications(questions);
      expect(answers[0]!.answer).toBe('Hayır');
    });

    it('should return empty array when no questions', async () => {
      const sb = new SmartBrief();
      sb.setAskFn(async () => 'should not be called');

      const answers = await sb.askClarifications([]);
      expect(answers).toHaveLength(0);
    });
  });

  // ── ADIM 4: buildAntiScope ─────────────────────────────

  describe('buildAntiScope', () => {
    const sb = new SmartBrief();

    it('should ban payment libs when no monetization', () => {
      const analysis = sb.analyzeBrief('basit app');
      const antiScope = sb.buildAntiScope(
        'basit app',
        analysis,
        [{ questionId: 'monetization', answer: 'Hayır, tamamen ücretsiz' }]
      );

      expect(antiScope.forbiddenDeps).toContain('stripe');
      expect(antiScope.forbiddenDeps).toContain('paddle');
      expect(antiScope.lockedDecisions).toContain('Ödeme sistemi yok');
    });

    it('should ban frontend frameworks for API-only', () => {
      const analysis = sb.analyzeBrief('backend API');
      const antiScope = sb.buildAntiScope(
        'backend API',
        analysis,
        [{ questionId: 'api-scope', answer: 'Sadece API' }]
      );

      expect(antiScope.forbiddenDeps).toContain('react');
      expect(antiScope.forbiddenDeps).toContain('vue');
      expect(antiScope.lockedDecisions).toContain('Frontend yok, sadece API');
    });

    it('should ban file upload deps when no file storage', () => {
      const analysis = sb.analyzeBrief('basit app');
      const antiScope = sb.buildAntiScope(
        'basit app',
        analysis,
        [{ questionId: 'file-storage', answer: 'Dosya yükleme yok' }]
      );

      expect(antiScope.forbiddenDeps).toContain('multer');
      expect(antiScope.forbiddenDeps).toContain('formidable');
    });

    it('should always protect MISSION.md', () => {
      const analysis = sb.analyzeBrief('herhangi');
      const antiScope = sb.buildAntiScope('herhangi', analysis, []);

      expect(antiScope.protectedFiles).toContain('MISSION.md');
    });

    it('should always include test protection', () => {
      const analysis = sb.analyzeBrief('herhangi');
      const antiScope = sb.buildAntiScope('herhangi', analysis, []);

      expect(antiScope.breakingChanges).toContain('Mevcut testler kırılmasın');
    });

    it('should deduplicate forbidden deps', () => {
      const analysis = sb.analyzeBrief('sadece API, backend');
      const antiScope = sb.buildAntiScope(
        'sadece API, backend',
        analysis,
        [{ questionId: 'api-scope', answer: 'Sadece API' }]
      );

      const reactCount = antiScope.forbiddenDeps.filter(d => d === 'react').length;
      expect(reactCount).toBeLessThanOrEqual(1);
    });
  });

  // ── ADIM 5: buildSummary ───────────────────────────────

  describe('buildSummary', () => {
    const sb = new SmartBrief();

    it('should show positive decisions with ✅', () => {
      const summary = sb.buildSummary(
        { auth: 'jwt', database: 'sqlite', apiStyle: 'rest', frontend: 'api-only', deployment: 'local' },
        { protectedFiles: [], lockedDecisions: [], forbiddenDeps: [], breakingChanges: [] },
        ['npm test geçmeli']
      );

      expect(summary).toContain('✅');
      expect(summary).toContain('JWT');
      expect(summary).toContain('SQLite');
      expect(summary).toContain('REST');
    });

    it('should show negative decisions with ❌', () => {
      const summary = sb.buildSummary(
        { auth: 'none', database: 'sqlite', apiStyle: 'rest', frontend: 'api-only', deployment: 'local' },
        { protectedFiles: [], lockedDecisions: ['Ödeme sistemi yok'], forbiddenDeps: [], breakingChanges: [] },
        ['npm test geçmeli']
      );

      expect(summary).toContain('❌');
      expect(summary).toContain('Auth yok');
      expect(summary).toContain('Ödeme sistemi yok');
      expect(summary).toContain('Frontend yok');
    });

    it('should include success criteria', () => {
      const summary = sb.buildSummary(
        { auth: 'jwt', database: 'sqlite', apiStyle: 'rest', frontend: 'api-only', deployment: 'local' },
        { protectedFiles: [], lockedDecisions: [], forbiddenDeps: [], breakingChanges: [] },
        ['npm test geçmeli', 'Auth endpoint çalışmalı']
      );

      expect(summary).toContain('npm test geçmeli');
      expect(summary).toContain('Auth endpoint çalışmalı');
    });
  });

  // ── Tam Akış: URL Shortener Senaryosu ──────────────────

  describe('full flow: URL shortener', () => {
    const BRIEF = 'URL shortener istiyorum, kayıt olsun, link tıklanınca redirect olsun, linkler süresi dolmasın';

    it('should detect correct tech decisions from brief', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief(BRIEF);

      // JWT çünkü "kayıt olsun"
      const auth = analysis.autoDecisions.find(d => d.key === 'auth');
      expect(auth?.value).toBe('jwt');

      // REST çünkü API
      const api = analysis.autoDecisions.find(d => d.key === 'apiStyle');
      expect(api?.value).toBe('rest');
    });

    it('should ask correct product questions', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief(BRIEF);

      const questionIds = analysis.uncertainQuestions.map(q => q.id);

      // Link erişim sorusu (herkese açık mı?)
      expect(questionIds).toContain('link-access');
      // Kullanıcı görünürlüğü
      expect(questionIds).toContain('user-visibility');
    });

    it('should infer success criteria from brief', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief(BRIEF);

      // Standart kriterler
      expect(analysis.inferredCriteria).toContain('npm test geçmeli');
      expect(analysis.inferredCriteria).toContain('TypeScript strict, 0 error');
      // Auth kriteri
      expect(analysis.inferredCriteria.some(c => c.includes('Auth'))).toBe(true);
      // Brief'teki fiillerden
      expect(analysis.inferredCriteria.some(c =>
        c.includes('redirect') || c.includes('kayıt') || c.includes('dolmasın')
      )).toBe(true);
    });

    it('should complete full non-interactive flow', () => {
      const sb = new SmartBrief();
      const result = sb.runNonInteractive(BRIEF, [
        { questionId: 'link-access', answer: 'Herkese açık' },
        { questionId: 'link-expiry', answer: 'Süresiz' },
        { questionId: 'user-visibility', answer: 'Hayır, sadece kendi' },
      ]);

      // Decisions
      expect(result.decisions.auth).toBe('jwt');
      expect(result.decisions.apiStyle).toBe('rest');
      expect(result.decisions.database).toBe('sqlite');
      expect(result.decisions.frontend).toBe('api-only');

      // Scope
      expect(result.scope.whatToBuild).toBe(BRIEF);
      expect(result.scope.stack).toBe('typescript-node');

      // Anti-scope
      expect(result.antiScope.protectedFiles).toContain('MISSION.md');

      // Timestamp
      expect(result.collectedAt).toBeTruthy();
    });

    it('should complete full interactive flow with mock', async () => {
      const sb = new SmartBrief();
      const responses = [
        BRIEF,  // ADIM 1: brief
        '1',    // link-access: Herkese açık
        '',     // link-expiry: default (Süresiz)
        '2',    // user-visibility: Hayır, sadece kendi
      ];
      let idx = 0;
      sb.setAskFn(async () => responses[idx++] ?? '');

      const result = await sb.run();

      expect(result.rawInput).toBe(BRIEF);
      expect(result.decisions.auth).toBe('jwt');
      expect(result.clarifications.length).toBeGreaterThan(0);

      // Link-expiry default kullanılmış olmalı
      const expiryAnswer = result.clarifications.find(a => a.questionId === 'link-expiry');
      expect(expiryAnswer?.answer).toBe('Süresiz');
    });

    it('should produce readable summary', () => {
      const sb = new SmartBrief();
      const result = sb.runNonInteractive(BRIEF);

      const summary = sb.buildSummary(
        result.decisions,
        result.antiScope,
        result.analysis.inferredCriteria
      );

      // İnsan okunabilir
      expect(summary).toContain('✅');
      expect(summary).toContain('JWT');
      expect(summary).toContain('SQLite');
      expect(summary).toContain('REST');
      expect(summary).toContain('Başarı Kriterleri');
    });
  });

  // ── Edge Cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty brief gracefully', () => {
      const sb = new SmartBrief();
      const result = sb.runNonInteractive('');

      // Default'lar uygulanmalı
      expect(result.decisions.auth).toBe('none');
      expect(result.decisions.database).toBe('sqlite');
      expect(result.decisions.apiStyle).toBe('rest');
    });

    it('should handle Turkish characters', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief('Kullanıcı girişi olan bir şifre yöneticisi');

      const auth = analysis.autoDecisions.find(d => d.key === 'auth');
      expect(auth?.value).toBe('jwt');
    });

    it('should detect GraphQL when mentioned', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief('GraphQL API ile bir e-ticaret backend');

      const api = analysis.autoDecisions.find(d => d.key === 'apiStyle');
      expect(api?.value).toBe('graphql');
    });

    it('should detect Docker deployment', () => {
      const sb = new SmartBrief();
      const analysis = sb.analyzeBrief('Docker ile deploy edilecek bir microservice');

      const deploy = analysis.autoDecisions.find(d => d.key === 'deployment');
      expect(deploy?.value).toBe('docker');
    });

    it('should detect Python stack', () => {
      const sb = new SmartBrief();
      const result = sb.runNonInteractive('Python ile FastAPI backend yaz');
      expect(result.scope.stack).toBe('python');
    });

    it('should use defaults for unanswered questions', () => {
      const sb = new SmartBrief();
      const result = sb.runNonInteractive(
        'URL shortener istiyorum, kayıt olsun'
        // No answers provided — all defaults
      );

      // Default answers applied
      const linkAccess = result.clarifications.find(a => a.questionId === 'link-access');
      expect(linkAccess?.answer).toBe('Herkese açık');
    });
  });
});
