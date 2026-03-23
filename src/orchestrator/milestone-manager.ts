/**
 * Milestone Manager — Aşamalı Planlama
 * 
 * Brief + mimari kararlardan milestone listesi üretir.
 * Her milestone bağımlı olduğu önceki milestone'lar tamamlandıktan sonra başlar.
 * STATE.md'ye milestone durumunu yazar.
 */

import type {
  ArchitectureDecisions,
  Milestone,
  MilestonePlan,
  MilestoneStatus,
  TaskDefinition,
} from '../types/index.js';

export class MilestoneManager {
  /**
   * Brief + mimari kararlardan milestone planı üret.
   * Her proje en az 3 milestone içerir.
   */
  createMilestones(
    _brief: string,
    architecture: ArchitectureDecisions
  ): MilestonePlan {
    const milestones: Milestone[] = [];
    let taskCounter = 1;

    const nextTaskId = (): string => `T${String(taskCounter++).padStart(3, '0')}`;

    // ── M01: Foundation ────────────────────────────────────
    const foundationTasks: TaskDefinition[] = [
      {
        id: nextTaskId(),
        title: 'Proje yapısı ve config',
        description: 'package.json, tsconfig.json, .env, temel klasör yapısı',
        type: 'code',
        dependencies: [],
        priority: 'critical',
        estimatedComplexity: 'simple',
        acceptanceCriteria: ['package.json mevcut', 'tsconfig.json mevcut', 'tsc --noEmit geçiyor'],
      },
    ];

    if (architecture.database !== 'in-memory') {
      foundationTasks.push({
        id: nextTaskId(),
        title: `${architecture.database} schema ve bağlantı`,
        description: `${architecture.database} veritabanı schema tanımı ve connection setup`,
        type: 'code',
        dependencies: [foundationTasks[0]!.id],
        priority: 'critical',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: ['DB bağlantısı çalışıyor', 'Schema migration mevcut'],
      });
    }

    milestones.push({
      id: 'M01',
      title: 'Foundation',
      description: 'Proje altyapısı, config, DB schema',
      dependsOn: [],
      tasks: foundationTasks,
      status: 'pending',
    });

    // ── M02: Auth (eğer seçildiyse) ───────────────────────
    if (architecture.auth !== 'none') {
      const authTasks: TaskDefinition[] = [
        {
          id: nextTaskId(),
          title: `${architecture.auth} auth implementasyonu`,
          description: `User model, ${architecture.auth} stratejisi, register/login`,
          type: 'code',
          dependencies: [],
          priority: 'high',
          estimatedComplexity: 'moderate',
          acceptanceCriteria: ['Register çalışıyor', 'Login çalışıyor', 'Auth middleware mevcut'],
        },
        {
          id: nextTaskId(),
          title: 'Auth testleri',
          description: 'Register, login, unauthorized access testleri',
          type: 'test',
          dependencies: [],
          priority: 'high',
          estimatedComplexity: 'simple',
          acceptanceCriteria: ['Auth testleri geçiyor', 'Coverage > 80%'],
        },
      ];
      // Auth testleri auth implementasyonuna bağımlı
      authTasks[1]!.dependencies = [authTasks[0]!.id];

      milestones.push({
        id: 'M02',
        title: 'Auth',
        description: `${architecture.auth} authentication sistemi`,
        dependsOn: ['M01'],
        tasks: authTasks,
        status: 'pending',
      });
    }

    // ── M03: API ──────────────────────────────────────────
    const apiDeps = architecture.auth !== 'none' ? ['M02'] : ['M01'];
    const apiTasks: TaskDefinition[] = [
      {
        id: nextTaskId(),
        title: `${architecture.apiStyle} endpoints`,
        description: `Ana business logic endpoints (${architecture.apiStyle} stili)`,
        type: 'code',
        dependencies: [],
        priority: 'high',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: ['CRUD endpoints çalışıyor', 'Validation mevcut', 'Error handling'],
      },
      {
        id: nextTaskId(),
        title: 'API testleri',
        description: 'Endpoint testleri, edge case\'ler',
        type: 'test',
        dependencies: [],
        priority: 'high',
        estimatedComplexity: 'simple',
        acceptanceCriteria: ['API testleri geçiyor'],
      },
    ];
    apiTasks[1]!.dependencies = [apiTasks[0]!.id];

    milestones.push({
      id: architecture.auth !== 'none' ? 'M03' : 'M02',
      title: 'API',
      description: `${architecture.apiStyle} API endpoints ve business logic`,
      dependsOn: apiDeps,
      tasks: apiTasks,
      status: 'pending',
    });

    // ── M04: Frontend (eğer seçildiyse) ───────────────────
    if (architecture.frontend !== 'api-only') {
      const prevMilestone = milestones[milestones.length - 1]!.id;
      const feId = `M${String(milestones.length + 1).padStart(2, '0')}`;

      milestones.push({
        id: feId,
        title: 'Frontend',
        description: `${architecture.frontend} frontend`,
        dependsOn: [prevMilestone],
        tasks: [
          {
            id: nextTaskId(),
            title: `${architecture.frontend} setup + routing`,
            description: `${architecture.frontend} projesi oluştur, routing, API entegrasyonu`,
            type: 'code',
            dependencies: [],
            priority: 'medium',
            estimatedComplexity: 'moderate',
            acceptanceCriteria: ['Frontend render oluyor', 'API ile konuşuyor'],
          },
        ],
        status: 'pending',
      });
    }

    // ── Final: Integration ────────────────────────────────
    const lastMilestone = milestones[milestones.length - 1]!.id;
    const integrationId = `M${String(milestones.length + 1).padStart(2, '0')}`;

    milestones.push({
      id: integrationId,
      title: 'Integration',
      description: 'E2E testler, docker-compose, final review',
      dependsOn: [lastMilestone],
      tasks: [
        {
          id: nextTaskId(),
          title: 'E2E entegrasyon testleri',
          description: 'Tüm sistem birlikte çalışıyor mu? E2E testleri yaz.',
          type: 'test',
          dependencies: [],
          priority: 'medium',
          estimatedComplexity: 'moderate',
          acceptanceCriteria: ['E2E testler geçiyor', 'Tüm milestone\'lar entegre'],
        },
      ],
      status: 'pending',
    });

    const totalTasks = milestones.reduce((sum, m) => sum + m.tasks.length, 0);

    return { milestones, totalTasks };
  }

  /**
   * STATE.md için milestone durumu render et
   */
  renderMilestoneState(milestones: Milestone[]): string {
    return milestones
      .map(m => {
        const icon = m.status === 'done' ? '[x]' : '[ ]';
        const status = m.status !== 'pending' ? ` — ${m.status}` : '';
        return `${icon} ${m.id}: ${m.title}${status}`;
      })
      .join('\n');
  }

  /**
   * Sonraki çalıştırılabilir milestone'u bul
   */
  getNextMilestone(milestones: Milestone[]): Milestone | null {
    for (const m of milestones) {
      if (m.status !== 'pending') continue;
      const depsComplete = m.dependsOn.every(depId => {
        const dep = milestones.find(x => x.id === depId);
        return dep?.status === 'done';
      });
      if (depsComplete) return m;
    }
    return null;
  }

  /**
   * Milestone durumunu güncelle
   */
  updateStatus(milestone: Milestone, status: MilestoneStatus): void {
    milestone.status = status;
    if (status === 'running' && !milestone.startedAt) {
      milestone.startedAt = new Date().toISOString();
    }
    if (status === 'done' || status === 'failed' || status === 'skipped') {
      milestone.completedAt = new Date().toISOString();
    }
  }
}
