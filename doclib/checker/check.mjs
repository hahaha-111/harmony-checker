#!/usr/bin/env node
/**
 * HarmonyOS ArkTS 代码质量检查工具
 * 
 * 功能：
 * 1. Resource 类型安全检查
 * 2. 中文硬编码扫描（页面文件）
 * 3. 多语言资源完整性检查
 * 4. 常见编译错误检测 (any 类型、跨后缀导入)
 * 5. 已废弃 API 检测（模块路径、函数等）
 * 6. "Function may throw" 缺失 try-catch 检测
 * 7. catch 类型标注检测（ArkTS 不支持 catch(e: Error)）
 * 8. 未使用 catch 变量
 * 
 * 用法：node check.mjs --project=<项目路径>
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
let projectPath = '.';
for (const arg of args) {
  if (arg.startsWith('--project=')) {
    projectPath = arg.replace('--project=', '');
  }
}

// ============================================================
// 统计
// ============================================================
const stats = {
  filesScanned: 0,
  errors: [],
  warnings: [],
  passes: []
};

function addError(category, file, line, msg, fix) {
  stats.errors.push({ category, file, line, msg, fix });
}
function addWarning(category, file, line, msg, fix) {
  stats.warnings.push({ category, file, line, msg, fix });
}
function addPass(msg) {
  stats.passes.push(msg);
}

// ============================================================
// 文件查找
// ============================================================
function findSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === '.git' || item === 'node_modules' || item === 'oh_modules' || item === 'build') continue;
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else if (item.endsWith('.ets') || item.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function findSourceDirs(root) {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (const item of list) {
      if (item === '.git' || item === 'node_modules' || item === 'oh_modules') continue;
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) walk(full);
    }
    if (dir.endsWith('main/ets')) results.push(dir);
  }
  walk(root);
  return results;
}

// 加载资源文件
function loadResources(projectPath) {
  const langs = ['zh_CN', 'ja_JP', 'en_US'];
  const result = {};
  for (const lang of langs) {
    const filePath = path.join(projectPath, 'entry/src/main/resources', lang, 'element/string.json');
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        result[lang] = new Set(data.string.map(i => i.name));
      } catch (e) {
        result[lang] = null;
        addWarning('I18N', filePath, 0, `解析 ${lang}/string.json 失败: ${e.message}`);
      }
    } else {
      result[lang] = null;
    }
  }
  return result;
}

// ============================================================
// 检查项
// ============================================================

/** 1. Resource 类型安全检查 */
function checkResourceSafety(filePath, content, lines) {
  const resourceRegex = /\$r\s*\(\s*'app\.string\.[a-z_0-9]+'\s*\)/g;
  let match;
  
  while ((match = resourceRegex.exec(content)) !== null) {
    const pos = match.index;
    const lineNum = content.substring(0, pos).split('\n').length;
    const line = lines[lineNum - 1];
    const resStr = match[0];
    
    if (line.includes('===') && line.includes(resStr)) {
      addWarning('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `=== 比较中使用了 ${resStr}，类型不匹配`,
        '改用 getContext(this).resourceManager.getStringSync($r(...)) 获取字符串后比较'
      );
    }
    
    if (line.includes('fillText')) {
      addError('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `ctx.fillText() 中使用了 ${resStr}，fillText 不接受 Resource`,
        '先用 getStringSync 转 string 再传入'
      );
    }
    
    const assignMatch = line.match(/this\.vm\.(\w+)\s*=\s*\$r/);
    if (assignMatch) {
      addWarning('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `vm.${assignMatch[1]} 赋值使用了 ${resStr}（vm 属性可能为 string 类型）`,
        '改用 getContext(this).resourceManager.getStringSync($r(...)) 转 string'
      );
    }
    
    if (line.includes('showToast') || line.includes('promptAction')) {
      addWarning('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `showToast/promptAction 中使用了 ${resStr}`,
        'promptAction.showToast 可能需要 string，用 getStringSync 转'
      );
    }
  }
}

/** 2. 中文硬编码（仅页面文件） */
function checkChineseHardcode(filePath, content, lines) {
  const isPage = filePath.includes('/pages/') || filePath.includes('\\pages\\');
  if (!isPage) return;
  
  const chineseRegex = /'([^']*[\u4e00-\u9fff][^']*)'/g;
  let match;
  
  while ((match = chineseRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const text = match[1];
    
    if (text.includes('/') || text.includes('\\')) continue;
    if (text === '无畏') continue;
    if (/^[📅🔑📜📂🔄⏳⚡🛠️📁✅❌⚠️➡️🔴🟡]+/.test(text)) continue;
    if (text.length < 2) continue;
    if (['已连接', '在线', '文件', '已连接', '已断开', '连接中'].includes(text)) continue;
    
    addWarning('HARDCODE', path.relative(projectPath, filePath), lineNum,
      `硬编码中文："${text}"`,
      '替换为 $r(\'app.string.xxx\') 并补充翻译'
    );
  }
}

/** 3. 资源完整性 */
function checkResourceIntegrity(filePath, content, resources) {
  const refRegex = /\$r\s*\(\s*'app\.string\.([a-z_0-9]+)'\s*\)/g;
  let match;
  
  while ((match = refRegex.exec(content)) !== null) {
    const name = match[1];
    for (const [lang, names] of Object.entries(resources)) {
      if (names === null) continue;
      if (!names.has(name)) {
        addWarning('I18N', path.relative(projectPath, filePath), 0,
          `"${name}" 未在 ${lang}/string.json 中定义`,
          `在 ${lang}/string.json 中补充`
        );
      }
    }
  }
}

/** 4. any 类型 */
function checkAnyType(filePath, content, lines) {
  lines.forEach((line, idx) => {
    if (line.includes(': any') || line.includes('as any')) {
      addWarning('ARKTS', path.relative(projectPath, filePath), idx + 1,
        `使用了 any 类型：${line.trim().substring(0, 60)}`,
        'ArkTS 禁止 any，改为具体类型'
      );
    }
  });
}

/** 5. .ts 导入 .ets */
function checkTsImportEts(filePath, content) {
  if (!filePath.endsWith('.ts')) return;
  const importRegex = /from\s+['"]\.\/.+\.ets['"]/g;
  if (importRegex.test(content)) {
    addError('ARKTS', path.relative(projectPath, filePath), 0,
      '.ts 文件导入了 .ets 文件（ArkTS 禁止跨后缀导入）',
      '将导入文件改为 .ts 或将本文件改为 .ets'
    );
  }
}

// ============================================================
// 新增检查项
// ============================================================

/** 6. 已废弃模块路径检测 (API 20 → @kit.*) */
const DEPRECATED_IMPORTS = [
  { old: '@ohos.router',      newer: "'{ router } from '@kit.ArkUI''" },
  { old: '@ohos.multimedia.media', newer: "'{ media } from '@kit.MediaKit''" },
  { old: '@ohos.multimedia.audio', newer: "'{ audio } from '@kit.MediaKit''" },
  { old: '@ohos.promptAction',    newer: "'{ promptAction } from '@kit.ArkUI''" },
  { old: '@ohos.ability.ability', newer: "'@kit.AbilityKit'" },
  { old: '@ohos.data.ability',    newer: "'@kit.DataKit'" },
  { old: '@ohos.net.http',        newer: "'@kit.NetworkKit'" },
];

function checkDeprecatedImports(filePath, content, lines) {
  for (const importLine of lines) {
    if (!importLine.includes('from') || !importLine.includes('@ohos.')) continue;
    const lineNum = lines.indexOf(importLine) + 1;
    for (const dep of DEPRECATED_IMPORTS) {
      if (importLine.includes(dep.old)) {
        addWarning('DEPRECATED', path.relative(projectPath, filePath), lineNum,
          `已废弃模块路径：${dep.old}`,
          `改用 ${dep.newer}`
        );
      }
    }
  }
}

/** 7. 已废弃 API 调用检测 */
function checkDeprecatedAPIs(filePath, content, lines) {
  const deprecatedPatterns = [
    { pattern: /AlertDialog\.(show|open)\s*\(/, name: 'AlertDialog.show/open', fix: '改用 promptAction.showDialog' },
    { pattern: /DatePickerDialog\.(show|open)\s*\(/, name: 'DatePickerDialog.show/open', fix: '改用 promptAction.showDialog' },
    { pattern: /fileIo\.show\s*\(/, name: 'fileIo.show', fix: '改用 promptAction.showDialog 或 console.warn' },
    { pattern: /fs\.show\s*\(/, name: 'fs.show', fix: '改用 promptAction.showDialog 或 console.warn' },
    { pattern: /decodeWithStream\s*\(/, name: 'decodeWithStream', fix: '改用 decode' },
  ];

  lines.forEach((line, idx) => {
    for (const dp of deprecatedPatterns) {
      if (dp.pattern.test(line)) {
        addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
          `已废弃 API：${dp.name} — ${line.trim().substring(0, 60)}`,
          dp.fix
        );
      }
    }
  });
}

/** 8. catch 类型标注检测：catch (e: Error) / catch (e: any) / catch (e: unknown) */
function checkCatchTypeAnnotation(filePath, content, lines) {
  const patterns = [
    /catch\s*\(\s*\w+\s*:\s*(Error|any|unknown)\s*\)/,
    /catch\s*\(\s*_\s*:\s*(Error|any|unknown)\s*\)/,
  ];
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      if (p.test(line)) {
        addWarning('ARKTS', path.relative(projectPath, filePath), idx + 1,
          `catch 带有类型标注：${line.trim().substring(0, 60)}`,
          'ArkTS (API 20) 不支持 catch 类型标注，改为 catch (e) 或 catch {}'
        );
      }
    }
  });
}

/** 9. 未使用 catch 变量：catch (err) {} */
function checkUnusedCatchVariable(filePath, content, lines) {
  // Matches: catch (ident) {} or catch (ident)  {  next line: }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // catch (xxx) {} on same line
    const sameLine = line.match(/catch\s*\(\s*(\w+)\s*\)\s*\{\s*\}\s*$/);
    if (sameLine) {
      // Only flag if the variable is used nowhere else in the file
      const varName = sameLine[1];
      const varRegex = new RegExp('\\b' + varName + '\\b', 'g');
      let count = 0, m;
      while ((m = varRegex.exec(content)) !== null) count++;
      if (count <= 1) {  // only appears in the catch clause itself
        addWarning('STYLE', path.relative(projectPath, filePath), i + 1,
          `未使用的 catch 变量：${varName}`,
          '改为 catch {}'
        );
      }
      continue;
    }
    
    // catch (xxx) { <newline> }
    const multiLine = line.match(/catch\s*\(\s*(\w+)\s*\)\s*\{\s*$/);
    if (multiLine) {
      const varName = multiLine[1];
      // Check if next line is just '}'
      if (i + 1 < lines.length && lines[i + 1].trim() === '}') {
        const varRegex = new RegExp('\\b' + varName + '\\b', 'g');
        let count = 0, m;
        while ((m = varRegex.exec(content)) !== null) count++;
        if (count <= 1) {
          addWarning('STYLE', path.relative(projectPath, filePath), i + 1,
            `未使用的 catch 变量：${varName}`,
            '改为 catch {}'
          );
        }
      }
    }
  }
}

/** 10. "Function may throw" — fs.* 调用未包裹 try-catch 的检测 (启发式) */
const THROWING_CALLS = [
  'fs.open(', 'fs.read(', 'fs.write(', 'fs.stat(', 'fs.close(', 'fs.mkdir(',
  'fs.unlink(', 'fs.rename(', 'fs.copyFile(', 'fs.access(', 'fs.listFile(',
  'fs.append(', 'fs.truncate(', 'fs.fstat(', 'fs.ftruncate(',
  'fileIo.open(', 'fileIo.read(', 'fileIo.write(', 'fileIo.stat(', 'fileIo.close(',
];

function checkMissingTryCatch(filePath, content, lines) {
  // Find async functions/methods that have throwing calls but no try-catch
  let inAsyncFn = false;
  let braceDepth = 0;
  let hasTry = false;
  let asyncFnStartLine = 0;
  const throwingCallsFound = [];
  
  const isAsyncLine = (l) => /^\s*(private\s+|public\s+)?async\s/.test(l) || /^\s*(private\s+|public\s+)?static\s+async\s/.test(l);
  const hasTryCatch = (l) => l.includes('try {') || l.includes('try{');
  
  lines.forEach((line, idx) => {
    if (!inAsyncFn) {
      // Check if this line starts an async function
      if (isAsyncLine(line) || (line.includes('async ') && line.includes('('))) {
        inAsyncFn = true;
        asyncFnStartLine = idx + 1;
        braceDepth = 0;
        hasTry = false;
        throwingCallsFound.length = 0;
      }
    }
    
    if (inAsyncFn) {
      // Count braces
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      
      if (hasTryCatch(line)) hasTry = true;
      
      // Check for throwing calls
      for (const tc of THROWING_CALLS) {
        if (line.includes(tc)) {
          throwingCallsFound.push({ call: tc, line: idx + 1 });
        }
      }
      
      // End of function
      if (braceDepth <= 0 && idx >= asyncFnStartLine) {
        if (throwingCallsFound.length > 0 && !hasTry) {
          // Report only first throwing call per function
          const first = throwingCallsFound[0];
          addWarning('SAFETY', path.relative(projectPath, filePath), first.line,
            `"Function may throw exceptions" — ${first.call} 未包裹 try-catch`,
            '用 try { ... } catch {} 包裹'
          );
        }
        inAsyncFn = false;
      }
    }
  });
}

// ============================================================
// 主流程
// ============================================================

console.log('\n📋 鸿蒙项目代码质量检查报告');
console.log('═══════════════════════════════');
console.log(`📁 项目：${path.basename(projectPath)}`);

// 发现所有 main/ets 目录
const allDirs = findSourceDirs(projectPath);
const sourceFiles = [];
for (const d of allDirs) {
  sourceFiles.push(...findSourceFiles(d));
}
stats.filesScanned = sourceFiles.length;
console.log(`📄 扫描文件：${sourceFiles.length} 个`);
allDirs.forEach(d => console.log(`   📂 ${path.relative(projectPath, d)}`));
console.log('');

// 加载资源
const resources = loadResources(projectPath);

for (const filePath of sourceFiles) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // 原有检查
  checkResourceSafety(filePath, content, lines);
  checkChineseHardcode(filePath, content, lines);
  checkResourceIntegrity(filePath, content, resources);
  checkAnyType(filePath, content, lines);
  checkTsImportEts(filePath, content);
  
  // 新增检查
  checkDeprecatedImports(filePath, content, lines);
  checkDeprecatedAPIs(filePath, content, lines);
  checkCatchTypeAnnotation(filePath, content, lines);
  checkUnusedCatchVariable(filePath, content, lines);
  checkMissingTryCatch(filePath, content, lines);
}

// ============================================================
// 输出
// ============================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (stats.errors.length > 0) {
  console.log(`❌ 错误：${stats.errors.length} 项（必须修复）`);
  for (const e of stats.errors) {
    console.log(`   [${e.category}] ${e.file}:${e.line}`);
    console.log(`   ${e.msg}`);
    console.log(`   修复：${e.fix}\n`);
  }
}

if (stats.warnings.length > 0) {
  console.log(`⚠️  警告：${stats.warnings.length} 项（建议修复）`);
  // Group by category
  const byCat = {};
  for (const e of stats.warnings) {
    if (!byCat[e.category]) byCat[e.category] = [];
    byCat[e.category].push(e);
  }
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`   ── ${cat} (${items.length} 项) ──`);
    for (const e of items.slice(0, 10)) {
      const fileShort = e.file.replace(/^entry\/src\/main\/ets\//, '');
      console.log(`   [${cat}] ${fileShort}:${e.line}`);
      console.log(`   ${e.msg}`);
      if (e.fix) console.log(`   修复：${e.fix}`);
      console.log('');
    }
    if (items.length > 10) {
      console.log(`   ... 还有 ${items.length - 10} 项同类型 (查看完整报告用 --verbose)`);
      console.log('');
    }
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ 通过 ${stats.passes.length} 项  ⚠️ 警告 ${stats.warnings.length} 项  ❌ 错误 ${stats.errors.length} 项`);
console.log('');

// Verbose mode: full output
if (args.includes('--verbose')) {
  console.log('══════════════ 完整报告 ══════════════');
  console.log(JSON.stringify(stats, null, 2));
}
