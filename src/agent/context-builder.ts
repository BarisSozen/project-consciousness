/**
 * Context Builder — Memory-Aware Prompt Oluşturma
 * 
 * Her agent'a gönderilen prompt, 4 hafıza dosyasının tam bağlamını içerir.
 * Agent tipi ve task'a göre prompt özelleştirilir.
 * 
 * Tasarım İlkesi #1: Memory-First — her karar hafızada iz bırakır.
 */

import type { 
  TaskDefinition, 
  MemorySnapshot,
  AgentConfig 
} from '../types/index.js';

/** Agent tipine göre system-level talimatlar */
const AGENT_PERSONAS: Record<string, string> = {
  coder: `Sen deneyimli bir yazılım mühendisisin.
Görevin: Verilen task'ı implement et, clean code yaz, testlerden geç.
KURALLAR:
- MISSION.md'deki amaçla %100 uyumlu kod yaz
- ARCHITECTURE.md'deki mimari kararlara uy
- DECISIONS.md'deki geçmiş kararlarla çelişme
- Sadece tanımlanan task'ı yap, kapsamı aşma
- Her dosya değişikliğini açıkla`,

  reviewer: `Sen bir kod review uzmanısın.
Görevin: Verilen kodu MISSION, ARCHITECTURE ve DECISIONS'a karşı denetle.
KONTROL LİSTESİ:
- Misyondan sapma var mı?
- Mimari ihlal var mı?
- Önceki kararlarla çelişki var mı?
- Kapsam dışına çıkılmış mı?
- Kod kalitesi yeterli mi?
Her bulguyu [PASS/WARN/FAIL] etiketiyle raporla.`,

  tester: `Sen bir QA mühendisisin.
Görevin: Verilen kod için kapsamlı test yaz ve çalıştır.
KURALLAR:
- Edge case'leri kapsa
- Vitest framework kullan
- Her test neden var açıkla
- Coverage raporla`,

  documenter: `Sen bir teknik yazar/dokumentasyon uzmanısın.
Görevin: Kodu, kararları ve mimariyi dokümante et.
KURALLAR:
- İnsan okunabilir markdown yaz
- Örnekler ekle
- ARCHITECTURE.md ile tutarlı ol`,
};

export class ContextBuilder {
  /**
   * Agent için tam prompt oluştur.
   * Yapı: Persona + Memory Context + Task Detail + Output Format
   */
  buildPrompt(
    task: TaskDefinition,
    memory: MemorySnapshot,
    agent: AgentConfig
  ): string {
    const persona = AGENT_PERSONAS[agent.type] ?? AGENT_PERSONAS['coder']!;
    const memoryContext = this.buildMemoryContext(memory);
    const taskDetail = this.buildTaskDetail(task);
    const outputFormat = this.buildOutputFormat(task);

    return `${persona}

═══════════════════════════════════════════════════
PROJE HAFIZASI — Bu bağlam her şeyin üstündedir
═══════════════════════════════════════════════════

${memoryContext}

═══════════════════════════════════════════════════
GÖREV
═══════════════════════════════════════════════════

${taskDetail}

═══════════════════════════════════════════════════
ÇIKTI FORMATI
═══════════════════════════════════════════════════

${outputFormat}
`;
  }

  /**
   * Hafıza bağlamını kompakt formatta oluştur.
   * Çok uzun hafızalar için özet versiyonu kullan.
   */
  buildMemoryContext(memory: MemorySnapshot): string {
    const sections = [
      this.section('MISSION (ASLA UNUTMA — Bu projenin varlık sebebi)', memory.files.mission),
      this.section('ARCHITECTURE (Mimari kararlar — bunlara uy)', memory.files.architecture),
      this.section('DECISIONS (Geçmiş kararlar — bunlarla çelişme)', memory.files.decisions),
      this.section('STATE (Şu anki durum)', memory.files.state),
    ];

    const full = sections.join('\n\n');

    // Token limiti aşılıyorsa (yaklaşık 30K karakter ~ 8K token), özetle
    if (full.length > 30_000) {
      return this.buildCompactMemoryContext(memory);
    }

    return full;
  }

  /**
   * Kompakt hafıza — çok büyük projeler için özet versiyonu
   */
  private buildCompactMemoryContext(memory: MemorySnapshot): string {
    // Mission tam kalır (kısa ve kritik)
    const mission = this.section('MISSION (TAM)', memory.files.mission);
    
    // Architecture'dan sadece ilkeleri al
    const archPrinciples = this.extractSection(memory.files.architecture, '## Tasarım İlkeleri');
    const arch = this.section('ARCHITECTURE (İlkeler)', archPrinciples || 'Bkz. ARCHITECTURE.md');
    
    // Decisions'dan son 5 kararı al
    const recentDecisions = this.extractRecentDecisions(memory.files.decisions, 5);
    const decisions = this.section('DECISIONS (Son 5)', recentDecisions);
    
    // State tam kalır (kısa)
    const state = this.section('STATE (TAM)', memory.files.state);

    return [mission, arch, decisions, state].join('\n\n');
  }

  private buildTaskDetail(task: TaskDefinition): string {
    return `### ${task.id}: ${task.title}

**Açıklama**: ${task.description}

**Tip**: ${task.type}
**Öncelik**: ${task.priority}
**Karmaşıklık**: ${task.estimatedComplexity}

**Bağımlılıklar**: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'Yok'}

**Kabul Kriterleri**:
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

⚠️ KAPSAM UYARISI: Sadece yukarıdaki kabul kriterlerini karşıla.
Ekstra özellik ekleme, scope creep yapma.`;
  }

  private buildOutputFormat(task: TaskDefinition): string {
    return `Çıktını şu yapıda ver:

## Sonuç
[BAŞARILI / BAŞARISIZ / KISMI]

## Yapılanlar
- Madde madde ne yaptın

## Oluşturulan/Değiştirilen Dosyalar
- dosya/yolu.ts — ne değişti

## Kabul Kriterleri Kontrolü
${task.acceptanceCriteria.map((c, i) => `- [ ] ${i + 1}. ${c}`).join('\n')}

## Notlar
Varsa ek notlar, uyarılar, öneriler`;
  }

  // ── Helpers ─────────────────────────────────────────────

  private section(title: string, content: string): string {
    return `### ${title}\n\n${content}`;
  }

  private extractSection(content: string, heading: string): string | null {
    const regex = new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  private extractRecentDecisions(content: string, count: number): string {
    const decisions = content.split(/(?=## D\d{3})/).filter(d => d.startsWith('## D'));
    const recent = decisions.slice(-count);
    return recent.join('\n---\n');
  }
}
