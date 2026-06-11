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
 * 9. throw 任意类型 (arkts-limited-throw)
 * 10. await 非 Promise 值
 * 11. 废弃全局 UI API (UIContext)
 * 12. List 组件缺少宽高初始化
 * 13. TextDecoder 废弃 API
 * 14. 音频 ContentType 废弃
 * 15. 未类型化对象字面量
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
// 检查项 1-5：原有检查
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
// 检查项 6-8：新增原有检查
// ============================================================

/** 6. 已废弃模块路径检测 (API 13+ → @kit.*) */
const DEPRECATED_IMPORTS = [
  { old: '@ohos.router',            newer: "'{ router } from '@kit.ArkUI''" },
  { old: '@ohos.multimedia.media',  newer: "'{ media } from '@kit.MediaKit''" },
  { old: '@ohos.multimedia.audio',  newer: "'{ audio } from '@kit.MediaKit''" },
  { old: '@ohos.promptAction',      newer: "'{ promptAction } from '@kit.ArkUI''" },
  { old: '@ohos.ability.ability',   newer: "'@kit.AbilityKit'" },
  { old: '@ohos.data.ability',      newer: "'@kit.DataKit'" },
  { old: '@ohos.net.http',          newer: "'@kit.NetworkKit'" },
  { old: '@ohos.file.fs',           newer: "'@kit.CoreFileKit'" },
  { old: '@ohos.file.picker',       newer: "'@kit.CoreFileKit'" },
  { old: '@ohos.notification',      newer: "'@kit.NotificationKit'" },
  { old: '@ohos.bluetooth',         newer: "'@kit.ConnectivityKit'" },
  { old: '@ohos.wifiManager',       newer: "'@kit.ConnectivityKit'" },
  { old: '@ohos.settings',          newer: "'@kit.SettingsKit'" },
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
    { pattern: /decodeWithStream\s*\(/, name: 'decodeWithStream', fix: '改用 decodeToString' },
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
          'ArkTS (API 13+) 不支持 catch 类型标注，改为 catch (e) 或 catch {}'
        );
      }
    }
  });
}

/** 9. 未使用 catch 变量：catch (err) {} */
function checkUnusedCatchVariable(filePath, content, lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // catch (xxx) {} on same line
    const sameLine = line.match(/catch\s*\(\s*(\w+)\s*\)\s*\{\s*\}\s*$/);
    if (sameLine) {
      const varName = sameLine[1];
      const varRegex = new RegExp('\\b' + varName + '\\b', 'g');
      let count = 0, m;
      while ((m = varRegex.exec(content)) !== null) count++;
      if (count <= 1) {
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
  'JSON.parse(', 'router.pushUrl(', 'router.replaceUrl(', 'router.back(',
  'promptAction.showToast(', 'promptAction.showDialog(',
  'Preferences.get(', 'Preferences.put(', 'Preferences.delete(',
];

function checkMissingTryCatch(filePath, content, lines) {
  let inAsyncFn = false;
  let braceDepth = 0;
  let hasTry = false;
  let asyncFnStartLine = 0;
  const throwingCallsFound = [];
  
  const isAsyncLine = (l) => /^\s*(private\s+|public\s+)?async\s/.test(l) || /^\s*(private\s+|public\s+)?static\s+async\s/.test(l);
  const hasTryCatch = (l) => l.includes('try {') || l.includes('try{');
  
  lines.forEach((line, idx) => {
    if (!inAsyncFn) {
      if (isAsyncLine(line) || (line.includes('async ') && line.includes('('))) {
        inAsyncFn = true;
        asyncFnStartLine = idx + 1;
        braceDepth = 0;
        hasTry = false;
        throwingCallsFound.length = 0;
      }
    }
    
    if (inAsyncFn) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      
      if (hasTryCatch(line)) hasTry = true;
      
      for (const tc of THROWING_CALLS) {
        if (line.includes(tc)) {
          throwingCallsFound.push({ call: tc, line: idx + 1 });
        }
      }
      
      if (braceDepth <= 0 && idx >= asyncFnStartLine) {
        if (throwingCallsFound.length > 0 && !hasTry) {
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
// 检查项 11-18：API 13 严格模式新增检查
// ============================================================

/** 11. throw 任意类型 (arkts-limited-throw)
 *  检测 catch 块内 throw e; 的写法 */
function checkThrowArbitraryType(filePath, content, lines) {
  let inCatch = false;
  let catchVariable = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect start of catch block: catch (e) {
    const catchMatch = line.match(/catch\s*\(\s*(\w+)\s*\)/);
    if (catchMatch) {
      inCatch = true;
      catchVariable = catchMatch[1];
      continue;
    }
    
    if (inCatch) {
      // Verify we're still inside the catch block by brace balance
      // Simple heuristic: check if line starts with '}'
      if (line.trim() === '}') {
        inCatch = false;
        catchVariable = null;
        continue;
      }
      
      // Detect: throw e; where e is the catch variable
      if (catchVariable && line.includes('throw ' + catchVariable + ';')) {
        addWarning('ARKTS', path.relative(projectPath, filePath), i + 1,
          `throw 任意类型：throw ${catchVariable}; — ArkTS 禁止抛出 unknown 类型`,
          `改为 throw new Error(String(${catchVariable}));`
        );
      }
    }
  }
}

/** 12. await 非 Promise 值检测
 *  检测已知同步 API 前错误使用 await */
function checkAwaitNonPromise(filePath, content, lines) {
  const syncApiPatterns = [
    'fs.mkdirSync(', 'fs.readSync(', 'fs.writeSync(', 'fs.statSync(',
    'fs.closeSync(', 'fs.unlinkSync(', 'fs.renameSync(', 'fs.copyFileSync(',
    'fs.accessSync(', 'fs.listFileSync(', 'fs.appendSync(', 'fs.truncateSync(',
  ];
  
  lines.forEach((line, idx) => {
    // Detect: await something that is a known sync method
    for (const syncApi of syncApiPatterns) {
      if (line.includes('await ') && line.includes(syncApi)) {
        addWarning('SAFETY', path.relative(projectPath, filePath), idx + 1,
          `await 非 Promise：${line.trim().substring(0, 60)}`,
          `移除 await，${syncApi} 为同步方法`
        );
      }
    }
    
    // Detect: await 后跟方法名但方法不是 async（启发式：声明处无 async）
    // 匹配 pattern: await someVar.someMethod() 但难以静态判断返回值类型
    // 这里仅检测常见明确的同步 API
  });
}

/** 13. 废弃全局 UI API (UIContext)
 *  检测 router.pushUrl/replaceUrl/back/getParams、getContext 等 */
function checkDeprecatedUIApis(filePath, content, lines) {
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // 全局 router 调用（非通过 UIContext）
    if (!line.includes('getUIContext') && !line.includes('getRouter')) {
      // router.pushUrl, router.replaceUrl, router.back, router.getParams
      const routerMatches = trimmed.match(/(?<!this\.getUIContext\(\)\.getRouter\(\)\.)(router\.(pushUrl|replaceUrl|back|getParams))\s*\(/);
      if (routerMatches) {
        addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
          `废弃全局 API：${routerMatches[1]}()`,
          '改用 this.getUIContext().getRouter().xxx()'
        );
      }
    }
    
    // getContext() 顶级调用（非 this 上下文）
    // 检测：const ctx = getContext(...) 但不是 getHostContext
    if (trimmed.startsWith('getContext(') && !trimmed.includes('getHostContext')) {
      // Only flag standalone getContext() calls used for things other than resourceManager
      if (!trimmed.includes('resourceManager')) {
        addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
          `废弃 API：getContext() 在 API 13 中已废弃`,
          '改用 getHostContext() 或 this.getUIContext().getHostContext()'
        );
      }
    }
  });
}

/** 14. List 组件缺少宽高初始化 */
function checkListNoDimension(filePath, content, lines) {
  // Look for pattern: List() { ... } without .width('100%') / .height('100%')
  // or just List() on its own line with chained methods
  let inListBlock = false;
  let listStartLine = 0;
  let hasWidth = false;
  let hasHeight = false;
  let listOpenedBrace = false;
  let braceCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect List() with possible chaining, but not as part of navigation
    if (!inListBlock && /^\s*List\s*\(\s*\)/.test(line) && !line.includes('LazyForEach') && !line.includes('@Builder')) {
      // Check if List() has chained .width or .height on the same line
      if (line.includes('.width(') && line.includes('.height(')) {
        continue; // Has both dimensions
      }
      
      inListBlock = true;
      listStartLine = i + 1;
      hasWidth = line.includes('.width(');
      hasHeight = line.includes('.height(');
      listOpenedBrace = false;
      braceCount = 0;
    }
    
    if (inListBlock) {
      // Track braces
      for (const ch of line) {
        if (ch === '{') { braceCount++; listOpenedBrace = true; }
        if (ch === '}') braceCount--;
      }
      
      // Check for .width() and .height() in chained calls
      if (line.includes('.width(')) hasWidth = true;
      if (line.includes('.height(')) hasHeight = true;
      
      // End of List block (braces balanced)
      if (listOpenedBrace && braceCount <= 0) {
        if (!hasWidth || !hasHeight) {
          const missing = [];
          if (!hasWidth) missing.push('.width(\'100%\')');
          if (!hasHeight) missing.push('.height(\'100%\')');
          addWarning('STYLE', path.relative(projectPath, filePath), listStartLine,
            `List 组件缺少宽高初始化，建议添加：${missing.join('、')}`,
            'ArkUI 要求长列表必须具有明确的边界尺寸，否则重绘性能差'
          );
        }
        inListBlock = false;
      }
    }
  }
}

/** 15. TextDecoder 废弃 API */
function checkTextDecoderDeprecated(filePath, content, lines) {
  lines.forEach((line, idx) => {
    if (line.includes('new util.TextDecoder(') || line.includes('new util.TextEncoder(')) {
      const apiName = line.includes('TextDecoder') ? 'TextDecoder' : 'TextEncoder';
      addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
        `废弃 API：new util.${apiName}() 构造函数已废弃`,
        `改用 util.${apiName}.create() 工厂方法`
      );
    }
    if (line.includes('decodeWithStream(')) {
      addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
        '废弃 API：decodeWithStream() 已废弃',
        '改用 decodeToString()'
      );
    }
  });
}

/** 16. 音频 ContentType 废弃 */
function checkAudioContentType(filePath, content, lines) {
  const deprecatedTypes = [
    'CONTENT_TYPE_UNKNOWN', 'CONTENT_TYPE_MUSIC', 'CONTENT_TYPE_SPEECH',
    'CONTENT_TYPE_RINGTONE', 'CONTENT_TYPE_MOVIE',
  ];
  
  lines.forEach((line, idx) => {
    for (const ct of deprecatedTypes) {
      if (line.includes('audio.ContentType.' + ct) || line.includes('ContentType.' + ct)) {
        addWarning('DEPRECATED', path.relative(projectPath, filePath), idx + 1,
          `废弃 API：${ct} 已废弃`,
          'API 10+ 只需指定 usage（如 audio.StreamUsage.STREAM_USAGE_ALARM），无需 contentType'
        );
      }
    }
  });
}

/** 17. 未类型化对象字面量 (arkts-no-untyped-obj-literals) */
function checkUntypedObjectLiterals(filePath, content, lines) {
  // 检测泛型字典拼装参数后传给要求特定 Interface 的系统 API
  // 典型模式：Record<string, ...> 拼装后传给 system API
  lines.forEach((line, idx) => {
    // 检测赋值给 Record<string, ...> 类型的变量但字面量未显式声明类型
    const recordAssign = line.match(/:\s*Record\s*<\s*string\s*,\s*[^>]+>\s*=\s*\{/);
    if (recordAssign) {
      addWarning('ARKTS', path.relative(projectPath, filePath), idx + 1,
        `未类型化对象字面量：${line.trim().substring(0, 60)}`,
        'ArkTS 禁止用 Record<string, ...> 拼装参数后传给特定 Interface 的 API，应直接使用符合 API 要求的对象字面量'
      );
    }
    
    // 检测 { [key: string]: ... } 索引签名对象字面量
    const indexSig = line.match(/\[\s*key\s*:\s*string\s*\].*=\s*\{/);
    if (indexSig) {
      addWarning('ARKTS', path.relative(projectPath, filePath), idx + 1,
        `索引签名对象字面量：${line.trim().substring(0, 60)}`,
        'ArkTS 禁止未类型化索引签名对象字面量动态传参'
      );
    }
  });
}

/** 18. 未使用的变量/导入检测（简化启发式） */
function checkUnusedDeclarations(filePath, content, lines) {
  // 查找 import 语句中未使用的命名导入
  const importDecls = [];
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim()).filter(n => n.length > 0);
    for (const name of names) {
      const cleanName = name.replace(/\s+as\s+\w+/, '').trim(); // handle "as" aliases
      if (cleanName !== '_') {
        importDecls.push(cleanName);
      }
    }
  }
  
  if (importDecls.length === 0) return;
  
  for (const decl of importDecls) {
    // Check if the import is used elsewhere in the file (not in the import statement itself)
    const regex = new RegExp('\\b' + decl + '\\b', 'g');
    let count = 0;
    let m;
    while ((m = regex.exec(content)) !== null) count++;
    // count includes the import declaration itself; if only 1 hit, it's unused
    if (count <= 1) {
      addWarning('STYLE', path.relative(projectPath, filePath), 0,
        `未使用的导入：${decl}`,
        '删除该导入声明'
      );
    }
  }
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
  
  // 1.0 版本新增检查
  checkDeprecatedImports(filePath, content, lines);
  checkDeprecatedAPIs(filePath, content, lines);
  checkCatchTypeAnnotation(filePath, content, lines);
  checkUnusedCatchVariable(filePath, content, lines);
  checkMissingTryCatch(filePath, content, lines);
  
  // API 13 严格模式新增检查
  checkThrowArbitraryType(filePath, content, lines);
  checkAwaitNonPromise(filePath, content, lines);
  checkDeprecatedUIApis(filePath, content, lines);
  checkListNoDimension(filePath, content, lines);
  checkTextDecoderDeprecated(filePath, content, lines);
  checkAudioContentType(filePath, content, lines);
  checkUntypedObjectLiterals(filePath, content, lines);
  checkUnusedDeclarations(filePath, content, lines);
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
