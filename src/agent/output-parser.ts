/**
 * Output Parser — Agent Çıktısını Yapısal Parse Etme
 * 
 * Agent'ın markdown çıktısını AgentResult'a dönüştürür.
 * Structured output beklenir ama best-effort parse yapar.
 */

import type { AgentResult } from '../types/index.js';

interface ParsedOutput {
  status: 'success' | 'failure' | 'partial';
  actions: string[];
  artifacts: string[];
  criteriaChecks: CriteriaCheck[];
  notes: string;
  rawOutput: string;
}

interface CriteriaCheck {
  criterion: string;
  passed: boolean;
}

export class OutputParser {
  /**
   * Agent stdout'unu AgentResult'a dönüştür
   */
  parse(
    taskId: string,
    agentId: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    duration: number
  ): AgentResult {
    // Exit code != 0 ise doğrudan failure
    if (exitCode !== 0) {
      return {
        taskId,
        agentId,
        success: false,
        output: this.formatFailureOutput(stdout, stderr, exitCode),
        artifacts: [],
        duration,
      };
    }

    const parsed = this.parseStructuredOutput(stdout);

    return {
      taskId,
      agentId,
      success: parsed.status !== 'failure',
      output: this.formatOutput(parsed),
      artifacts: parsed.artifacts,
      duration,
    };
  }

  /**
   * Markdown yapısında çıktıyı parse et
   */
  private parseStructuredOutput(raw: string): ParsedOutput {
    return {
      status: this.extractStatus(raw),
      actions: this.extractActions(raw),
      artifacts: this.extractArtifacts(raw),
      criteriaChecks: this.extractCriteriaChecks(raw),
      notes: this.extractNotes(raw),
      rawOutput: raw,
    };
  }

  private extractStatus(raw: string): 'success' | 'failure' | 'partial' {
    const statusLine = raw.match(/## Sonuç\s*\n\s*\[?(BAŞARILI|BAŞARISIZ|KISMI)\]?/i);
    
    if (statusLine) {
      const s = statusLine[1]!.toUpperCase();
      if (s === 'BAŞARILI') return 'success';
      if (s === 'BAŞARISIZ') return 'failure';
      if (s === 'KISMI') return 'partial';
    }

    // Fallback: heuristic
    const lower = raw.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('hata')) {
      return 'failure';
    }
    if (lower.includes('partial') || lower.includes('kısmen')) {
      return 'partial';
    }
    return 'success';
  }

  private extractActions(raw: string): string[] {
    const section = this.getSection(raw, 'Yapılanlar');
    if (!section) return [];

    return section
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }

  private extractArtifacts(raw: string): string[] {
    const section = this.getSection(raw, 'Oluşturulan/Değiştirilen Dosyalar')
      ?? this.getSection(raw, 'Dosyalar');
    
    if (!section) {
      // Fallback: dosya yolu pattern'lerini tara
      return this.scanForFilePaths(raw);
    }

    return section
      .split('\n')
      .map(line => {
        // "- dosya/yolu.ts — açıklama" formatından path çıkar
        const match = line.match(/^[-*]\s*`?([^\s`—]+\.\w+)`?/);
        return match?.[1] ?? '';
      })
      .filter(path => path.length > 0);
  }

  private extractCriteriaChecks(raw: string): CriteriaCheck[] {
    const section = this.getSection(raw, 'Kabul Kriterleri Kontrolü')
      ?? this.getSection(raw, 'Kabul Kriterleri');
    
    if (!section) return [];

    return section
      .split('\n')
      .filter(line => /^[-*]\s*\[[ x]\]/.test(line))
      .map(line => ({
        criterion: line.replace(/^[-*]\s*\[[ x]\]\s*\d*\.?\s*/, '').trim(),
        passed: line.includes('[x]') || line.includes('[X]'),
      }));
  }

  private extractNotes(raw: string): string {
    const section = this.getSection(raw, 'Notlar');
    return section ?? '';
  }

  // ── Helpers ─────────────────────────────────────────────

  private getSection(raw: string, heading: string): string | null {
    // ## Heading veya ### Heading
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`#{2,3}\\s*${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)`);
    const match = raw.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  private scanForFilePaths(raw: string): string[] {
    // src/xxx.ts, tests/xxx.test.ts gibi pattern'leri bul
    const matches = raw.match(/(?:^|\s)((?:src|tests?|lib|dist)\/[\w/.-]+\.\w+)/gm);
    if (!matches) return [];

    return [...new Set(
      matches.map(m => m.trim())
    )];
  }

  private formatOutput(parsed: ParsedOutput): string {
    const parts: string[] = [];

    parts.push(`Status: ${parsed.status}`);

    if (parsed.actions.length > 0) {
      parts.push(`Actions:\n${parsed.actions.map(a => `  - ${a}`).join('\n')}`);
    }

    if (parsed.artifacts.length > 0) {
      parts.push(`Artifacts: ${parsed.artifacts.join(', ')}`);
    }

    if (parsed.criteriaChecks.length > 0) {
      const passed = parsed.criteriaChecks.filter(c => c.passed).length;
      const total = parsed.criteriaChecks.length;
      parts.push(`Criteria: ${passed}/${total} passed`);
    }

    if (parsed.notes) {
      parts.push(`Notes: ${parsed.notes.slice(0, 200)}`);
    }

    return parts.join('\n');
  }

  private formatFailureOutput(stdout: string, stderr: string, exitCode: number): string {
    const parts = [`Exit code: ${exitCode}`];
    
    if (stderr) {
      parts.push(`Stderr: ${stderr.slice(0, 500)}`);
    }
    if (stdout) {
      parts.push(`Stdout (last 500): ${stdout.slice(-500)}`);
    }

    return parts.join('\n');
  }
}
