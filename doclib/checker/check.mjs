#!/usr/bin/env node
/**
 * HarmonyOS ArkTS 代码质量检查工具
 * 
 * 功能：
 * 1. Resource 类型安全检查
 * 2. 中文硬编码扫描（页面文件）
 * 3. 多语言资源完整性检查
 * 4. 常见编译错误检测 (any 类型、跨后缀导入)
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
    
    // === 比较
    if (line.includes('===') && line.includes(resStr)) {
      addWarning('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `=== 比较中使用了 ${resStr}，类型不匹配`,
        '改用 getContext(this).resourceManager.getStringSync($r(...)) 获取字符串后比较'
      );
    }
    
    // fillText
    if (line.includes('fillText')) {
      addError('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `ctx.fillText() 中使用了 ${resStr}，fillText 不接受 Resource`,
        '先用 getStringSync 转 string 再传入'
      );
    }
    
    // vm.xxx = $r 赋值
    const assignMatch = line.match(/this\.vm\.(\w+)\s*=\s*\$r/);
    if (assignMatch) {
      addWarning('RESOURCE', path.relative(projectPath, filePath), lineNum,
        `vm.${assignMatch[1]} 赋值使用了 ${resStr}（vm 属性可能为 string 类型）`,
        '改用 getContext(this).resourceManager.getStringSync($r(...)) 转 string'
      );
    }
    
    // promptAction
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
    
    // 排除项
    if (text.includes('/') || text.includes('\\')) continue; // 路径
    if (text === '无畏') continue; // App名称
    if (/^[📅🔑📜📂🔄⏳⚡🛠️📁✅❌⚠️➡️]+/.test(text)) continue; // emoji
    if (text.length < 2) continue;
    if (text === '已连接' || text === '在线' || text === '文件') continue; // 状态常量/文件夹标签
    
    // 排除文件路径后缀（如 '${y}-${m}...' 这种模板字符串不会匹配中文）
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
  
  checkResourceSafety(filePath, content, lines);
  checkChineseHardcode(filePath, content, lines);
  checkResourceIntegrity(filePath, content, resources);
  checkAnyType(filePath, content, lines);
  checkTsImportEts(filePath, content);
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
  for (const e of stats.warnings) {
    console.log(`   [${e.category}] ${e.file}:${e.line}`);
    console.log(`   ${e.msg}`);
    if (e.fix) console.log(`   修复：${e.fix}`);
    console.log('');
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ 通过 ${stats.passes.length} 项  ⚠️ 警告 ${stats.warnings.length} 项  ❌ 错误 ${stats.errors.length} 项`);
console.log('');
