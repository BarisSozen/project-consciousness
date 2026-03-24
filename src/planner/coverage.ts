/**
 * Coverage Matrix — Aim Tree × Tech Plan Kesişimi
 *
 * İki planlama vektörünü cross-reference eder:
 * - Covered: aim'e bağlanmış task'lar var
 * - Uncovered: hiçbir task'la eşleşmeyen aim'ler (GAP)
 * - Orphan: hiçbir aim'e bağlanmamış task'lar
 *
 * Keyword-based matching + manual linking desteği.
 */

import type { AimNode, ProjectPhase, CoverageMatrix } from '../types/index.js';

/**
 * Aim tree ile tech plan arasında coverage analizi yap.
 * Keyword matching ile otomatik link oluşturur.
 */
export function computeCoverage(
  aimRoot: AimNode,
  phases: ProjectPhase[]
): CoverageMatrix {
  // Tüm leaf aim'leri topla (children'ı olmayanlar)
  const leafAims = collectLeafAims(aimRoot);

  // Tüm task'ları topla
  const allTasks: Array<{ id: string; title: string; phase: string }> = [];
  for (const phase of phases) {
    for (const task of phase.tasks) {
      allTasks.push({ id: task.id, title: task.title, phase: phase.name });
    }
  }

  // Keyword matching ile otomatik link
  for (const leaf of leafAims) {
    const aimWords = extractKeywords(leaf.aim);

    for (const task of allTasks) {
      const taskWords = extractKeywords(task.title + ' ' + task.phase);

      // En az 2 keyword overlap → link
      const overlap = aimWords.filter(w => taskWords.includes(w));
      if (overlap.length >= 1 && !leaf.linkedTasks.includes(task.id)) {
        leaf.linkedTasks.push(task.id);
      }
    }
  }

  // Coverage matrix oluştur
  const covered: CoverageMatrix['covered'] = [];
  const uncovered: CoverageMatrix['uncovered'] = [];

  for (const leaf of leafAims) {
    if (leaf.linkedTasks.length > 0) {
      covered.push({ aimId: leaf.id, aim: leaf.aim, taskIds: leaf.linkedTasks });
    } else {
      uncovered.push({ aimId: leaf.id, aim: leaf.aim });
    }
  }

  // Orphan tasks — hiçbir aim'e bağlanmamış
  const linkedTaskIds = new Set(leafAims.flatMap(a => a.linkedTasks));
  const orphanTasks: CoverageMatrix['orphanTasks'] = allTasks
    .filter(t => !linkedTaskIds.has(t.id))
    .map(t => ({ taskId: t.id, title: t.title }));

  return { covered, uncovered, orphanTasks };
}

/**
 * Coverage matrix'i konsola yazdır
 */
export function printCoverage(coverage: CoverageMatrix): void {
  console.log('\n  ━━━ COVERAGE MATRIX ━━━\n');

  if (coverage.covered.length > 0) {
    console.log('  ✅ Covered Aims:');
    for (const c of coverage.covered) {
      console.log(`     ${c.aimId}: ${c.aim} → [${c.taskIds.join(', ')}]`);
    }
  }

  if (coverage.uncovered.length > 0) {
    console.log('\n  ⚠️  Uncovered Aims (GAP):');
    for (const u of coverage.uncovered) {
      console.log(`     ${u.aimId}: ${u.aim} → ❌ No tasks`);
    }
  }

  if (coverage.orphanTasks.length > 0) {
    console.log('\n  🔸 Orphan Tasks (aim\'e bağlanmamış):');
    for (const o of coverage.orphanTasks) {
      console.log(`     ${o.taskId}: ${o.title}`);
    }
  }

  const total = coverage.covered.length + coverage.uncovered.length;
  const pct = total > 0 ? Math.round((coverage.covered.length / total) * 100) : 0;
  console.log(`\n  📊 Coverage: ${coverage.covered.length}/${total} aims (${pct}%)`);
  if (coverage.uncovered.length > 0) {
    console.log(`  ⚠️  ${coverage.uncovered.length} aim karşılanmıyor — plan\'a yeni task ekle veya aim\'i daralt`);
  }
  console.log('');
}

/**
 * Coverage bilgisini markdown formatında render et
 */
export function renderCoverageMd(coverage: CoverageMatrix): string {
  const lines: string[] = [];
  lines.push('## Coverage Matrix');
  lines.push('');

  const total = coverage.covered.length + coverage.uncovered.length;
  const pct = total > 0 ? Math.round((coverage.covered.length / total) * 100) : 0;
  lines.push(`> Coverage: ${coverage.covered.length}/${total} aims (${pct}%)`);
  lines.push('');

  if (coverage.covered.length > 0) {
    lines.push('### Covered');
    lines.push('');
    lines.push('| Aim | Tasks |');
    lines.push('|-----|-------|');
    for (const c of coverage.covered) {
      lines.push(`| ${c.aimId}: ${c.aim} | ${c.taskIds.join(', ')} |`);
    }
    lines.push('');
  }

  if (coverage.uncovered.length > 0) {
    lines.push('### ⚠️ Uncovered (GAP)');
    lines.push('');
    for (const u of coverage.uncovered) {
      lines.push(`- **${u.aimId}**: ${u.aim} — task eklenmeli`);
    }
    lines.push('');
  }

  if (coverage.orphanTasks.length > 0) {
    lines.push('### Orphan Tasks');
    lines.push('');
    for (const o of coverage.orphanTasks) {
      lines.push(`- ${o.taskId}: ${o.title} — aim\'e bağlanmalı`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────

function collectLeafAims(node: AimNode): AimNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(child => collectLeafAims(child));
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'for', 'and', 'nor',
    'but', 'or', 'yet', 'so', 'in', 'on', 'at', 'to', 'of', 'with', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again',
    'bir', 'bu', 've', 'ile', 'için', 'da', 'de', 'mi', 'mı', 'mu', 'mü',
    'olan', 'olarak', 'olmalı', 'gibi', 'her', 'çok', 'en', 'daha',
    'src', 'index', 'ts', 'js', 'tsx',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-zçğıöşü0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}
