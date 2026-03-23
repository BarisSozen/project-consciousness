/**
 * Output Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { OutputParser } from '../src/agent/output-parser.js';

describe('OutputParser', () => {
  const parser = new OutputParser();

  it('should parse successful structured output', () => {
    const stdout = `## Sonuç
[BAŞARILI]

## Yapılanlar
- Created memory-layer.ts
- Added snapshot functionality
- Wrote unit tests

## Oluşturulan/Değiştirilen Dosyalar
- src/memory/memory-layer.ts — new file
- tests/memory-layer.test.ts — new file

## Kabul Kriterleri Kontrolü
- [x] 1. Memory files are read correctly
- [x] 2. State updates work
- [ ] 3. Decisions append-only

## Notlar
All tests passing.`;

    const result = parser.parse('T001', 'coder', stdout, '', 0, 5000);
    
    expect(result.success).toBe(true);
    expect(result.taskId).toBe('T001');
    expect(result.agentId).toBe('coder');
    expect(result.artifacts).toContain('src/memory/memory-layer.ts');
    expect(result.artifacts).toContain('tests/memory-layer.test.ts');
    expect(result.output).toContain('Status: success');
    expect(result.output).toContain('2/3 passed');
    expect(result.duration).toBe(5000);
  });

  it('should parse failure from exit code', () => {
    const result = parser.parse('T002', 'coder', 'some output', 'Error: crash', 1, 3000);
    
    expect(result.success).toBe(false);
    expect(result.output).toContain('Exit code: 1');
    expect(result.output).toContain('Error: crash');
  });

  it('should detect failure from structured output', () => {
    const stdout = `## Sonuç
[BAŞARISIZ]

## Notlar
Could not complete task due to dependency issues.`;

    const result = parser.parse('T003', 'coder', stdout, '', 0, 2000);
    
    expect(result.success).toBe(false);
    expect(result.output).toContain('Status: failure');
  });

  it('should detect partial completion', () => {
    const stdout = `## Sonuç
[KISMI]

## Yapılanlar
- Completed half of the task

## Notlar
Need more time for the rest.`;

    const result = parser.parse('T004', 'coder', stdout, '', 0, 4000);
    
    expect(result.success).toBe(true); // partial counts as success
    expect(result.output).toContain('Status: partial');
  });

  it('should fallback to heuristic status detection', () => {
    const stdout = 'This is unstructured output with error messages';
    const result = parser.parse('T005', 'coder', stdout, '', 0, 1000);
    
    expect(result.success).toBe(false);
  });

  it('should scan for file paths when no structured section', () => {
    const stdout = `I created these files:
src/agent/runner.ts is the main module
tests/agent.test.ts contains the tests`;

    const result = parser.parse('T006', 'coder', stdout, '', 0, 1000);
    
    expect(result.artifacts).toContain('src/agent/runner.ts');
    expect(result.artifacts).toContain('tests/agent.test.ts');
  });

  it('should handle empty output', () => {
    const result = parser.parse('T007', 'coder', '', '', 0, 100);
    
    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(0);
  });
});
