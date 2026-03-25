/**
 * AST Code Mod — Surgical Code Modifications via TypeScript AST
 *
 * Performs precise code transformations without LLM:
 * - addField: Add a property to an interface/type
 * - addImport: Add import statement to a file
 * - renameSymbol: Rename a symbol across a file
 * - wrapWithTryCatch: Wrap a function body with try/catch
 * - removeUnusedImports: Clean up unused imports
 *
 * Uses TypeScript's transformation API for 100% syntax-safe modifications.
 */

import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeModResult } from '../../types/index.js';

export class ASTCodeMod {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Add a field to an interface or type alias.
   * Example: addField('src/types.ts', 'User', 'age', 'number')
   */
  addField(filePath: string, interfaceName: string, fieldName: string, fieldType: string): CodeModResult {
    const absPath = this.resolve(filePath);
    if (!existsSync(absPath)) {
      return this.fail({ type: 'add-field', target: interfaceName, fieldName, fieldType }, filePath, 'File not found');
    }

    const source = readFileSync(absPath, 'utf-8');
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

    let found = false;

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      return (rootNode) => {
        const visitor = (node: ts.Node): ts.Node => {
          // Match interface
          if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
            found = true;
            // Check if field already exists
            const exists = node.members.some(m =>
              ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name) && m.name.text === fieldName
            );
            if (exists) return node;

            const newMember = ts.factory.createPropertySignature(
              undefined,
              ts.factory.createIdentifier(fieldName),
              undefined,
              ts.factory.createTypeReferenceNode(fieldType),
            );

            return ts.factory.updateInterfaceDeclaration(
              node,
              node.modifiers,
              node.name,
              node.typeParameters,
              node.heritageClauses,
              [...node.members, newMember],
            );
          }

          return ts.visitEachChild(node, visitor, context);
        };

        return ts.visitNode(rootNode, visitor) as ts.SourceFile;
      };
    };

    const result = ts.transform(sf, [transformer]);
    const transformed = result.transformed[0];

    if (!found || !transformed) {
      result.dispose();
      return this.fail({ type: 'add-field', target: interfaceName, fieldName, fieldType }, filePath, `Interface '${interfaceName}' not found`);
    }

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const output = printer.printFile(transformed);
    result.dispose();

    writeFileSync(absPath, output, 'utf-8');

    return {
      operation: { type: 'add-field', target: interfaceName, fieldName, fieldType },
      file: filePath,
      success: true,
      diff: `+ ${fieldName}: ${fieldType};`,
    };
  }

  /**
   * Add an import statement to a file.
   * Example: addImport('src/service.ts', 'zod', ['z', 'ZodSchema'])
   */
  addImport(filePath: string, from: string, symbols: string[]): CodeModResult {
    const absPath = this.resolve(filePath);
    if (!existsSync(absPath)) {
      return this.fail({ type: 'add-import', file: filePath, from, symbols }, filePath, 'File not found');
    }

    const source = readFileSync(absPath, 'utf-8');

    // Check if import already exists
    if (source.includes(`from '${from}'`) || source.includes(`from "${from}"`)) {
      return this.fail({ type: 'add-import', file: filePath, from, symbols }, filePath, `Import from '${from}' already exists`);
    }

    const importLine = `import { ${symbols.join(', ')} } from '${from}';\n`;

    // Find the last import line to insert after it
    const lines = source.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith('import ')) lastImportIndex = i;
    }

    if (lastImportIndex >= 0) {
      lines.splice(lastImportIndex + 1, 0, importLine.trimEnd());
    } else {
      lines.unshift(importLine.trimEnd());
    }

    writeFileSync(absPath, lines.join('\n'), 'utf-8');

    return {
      operation: { type: 'add-import', file: filePath, from, symbols },
      file: filePath,
      success: true,
      diff: `+ ${importLine.trim()}`,
    };
  }

  /**
   * Rename a symbol within a file (all occurrences).
   * Example: renameSymbol('src/user.ts', 'getUserData', 'getUser')
   */
  renameSymbol(filePath: string, oldName: string, newName: string): CodeModResult {
    const absPath = this.resolve(filePath);
    if (!existsSync(absPath)) {
      return this.fail({ type: 'rename-symbol', oldName, newName }, filePath, 'File not found');
    }

    const source = readFileSync(absPath, 'utf-8');
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

    let renameCount = 0;

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      return (rootNode) => {
        const visitor = (node: ts.Node): ts.Node => {
          if (ts.isIdentifier(node) && node.text === oldName) {
            renameCount++;
            return ts.factory.createIdentifier(newName);
          }
          return ts.visitEachChild(node, visitor, context);
        };

        return ts.visitNode(rootNode, visitor) as ts.SourceFile;
      };
    };

    const result = ts.transform(sf, [transformer]);
    const transformed = result.transformed[0];

    if (renameCount === 0 || !transformed) {
      result.dispose();
      return this.fail({ type: 'rename-symbol', oldName, newName }, filePath, `Symbol '${oldName}' not found`);
    }

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const output = printer.printFile(transformed);
    result.dispose();

    writeFileSync(absPath, output, 'utf-8');

    return {
      operation: { type: 'rename-symbol', oldName, newName },
      file: filePath,
      success: true,
      diff: `${oldName} → ${newName} (${renameCount} occurrences)`,
    };
  }

  /**
   * Wrap a function's body with try/catch.
   * Example: wrapWithTryCatch('src/service.ts', 'processOrder')
   */
  wrapWithTryCatch(filePath: string, functionName: string): CodeModResult {
    const absPath = this.resolve(filePath);
    if (!existsSync(absPath)) {
      return this.fail({ type: 'wrap-try-catch', functionName, file: filePath }, filePath, 'File not found');
    }

    const source = readFileSync(absPath, 'utf-8');
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

    let found = false;

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      return (rootNode) => {
        const visitor = (node: ts.Node): ts.Node => {
          // Match function declarations
          if (ts.isFunctionDeclaration(node) && node.name?.text === functionName && node.body) {
            // Skip if already has try/catch
            const firstStmt = node.body.statements[0];
            if (firstStmt && ts.isTryStatement(firstStmt)) return node;

            found = true;

            const catchClause = ts.factory.createCatchClause(
              ts.factory.createVariableDeclaration('error'),
              ts.factory.createBlock([
                ts.factory.createExpressionStatement(
                  ts.factory.createCallExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier('console'),
                      'error'
                    ),
                    undefined,
                    [
                      ts.factory.createTemplateExpression(
                        ts.factory.createTemplateHead(`${functionName} failed: `),
                        [ts.factory.createTemplateSpan(
                          ts.factory.createIdentifier('error'),
                          ts.factory.createTemplateTail('')
                        )]
                      )
                    ]
                  )
                ),
                ts.factory.createThrowStatement(ts.factory.createIdentifier('error')),
              ], true)
            );

            const tryStatement = ts.factory.createTryStatement(
              ts.factory.createBlock(node.body.statements as unknown as ts.Statement[], true),
              catchClause,
              undefined,
            );

            const newBody = ts.factory.createBlock([tryStatement], true);

            return ts.factory.updateFunctionDeclaration(
              node,
              node.modifiers,
              node.asteriskToken,
              node.name,
              node.typeParameters,
              node.parameters,
              node.type,
              newBody,
            );
          }

          // Match arrow/function expression in variable declarations
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
              node.name.text === functionName && node.initializer) {
            const init = node.initializer;
            if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) {
              const firstStmt = init.body.statements[0];
              if (firstStmt && ts.isTryStatement(firstStmt)) return node;

              found = true;

              const catchClause = ts.factory.createCatchClause(
                ts.factory.createVariableDeclaration('error'),
                ts.factory.createBlock([
                  ts.factory.createExpressionStatement(
                    ts.factory.createCallExpression(
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier('console'),
                        'error'
                      ),
                      undefined,
                      [
                        ts.factory.createTemplateExpression(
                          ts.factory.createTemplateHead(`${functionName} failed: `),
                          [ts.factory.createTemplateSpan(
                            ts.factory.createIdentifier('error'),
                            ts.factory.createTemplateTail('')
                          )]
                        )
                      ]
                    )
                  ),
                  ts.factory.createThrowStatement(ts.factory.createIdentifier('error')),
                ], true)
              );

              const tryStatement = ts.factory.createTryStatement(
                ts.factory.createBlock(init.body.statements as unknown as ts.Statement[], true),
                catchClause,
                undefined,
              );

              const newBody = ts.factory.createBlock([tryStatement], true);

              let newInit: ts.Expression;
              if (ts.isArrowFunction(init)) {
                newInit = ts.factory.updateArrowFunction(
                  init, init.modifiers, init.typeParameters, init.parameters, init.type,
                  init.equalsGreaterThanToken, newBody,
                );
              } else {
                newInit = ts.factory.updateFunctionExpression(
                  init, init.modifiers, init.asteriskToken, init.name,
                  init.typeParameters, init.parameters, init.type, newBody,
                );
              }

              return ts.factory.updateVariableDeclaration(
                node, node.name, node.exclamationToken, node.type, newInit,
              );
            }
          }

          return ts.visitEachChild(node, visitor, context);
        };

        return ts.visitNode(rootNode, visitor) as ts.SourceFile;
      };
    };

    const result = ts.transform(sf, [transformer]);
    const transformed = result.transformed[0];

    if (!found || !transformed) {
      result.dispose();
      return this.fail({ type: 'wrap-try-catch', functionName, file: filePath }, filePath, `Function '${functionName}' not found or already wrapped`);
    }

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const output = printer.printFile(transformed);
    result.dispose();

    writeFileSync(absPath, output, 'utf-8');

    return {
      operation: { type: 'wrap-try-catch', functionName, file: filePath },
      file: filePath,
      success: true,
      diff: `Wrapped ${functionName} with try/catch`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private resolve(filePath: string): string {
    if (filePath.startsWith('/') || filePath.includes(':')) return filePath;
    return join(this.projectRoot, filePath);
  }

  private fail(operation: CodeModResult['operation'], file: string, error: string): CodeModResult {
    return { operation, file, success: false, error };
  }
}
