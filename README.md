# Harmony Checker 🐉

HarmonyOS ArkTS 代码质量检查工具。自动扫描项目中的多语言、Resource 类型、硬编码中文等常见问题。

## 快速开始

```bash
npx harmony-checker --project=./my-harmony-app
# 或
node doclib/checker/check.mjs --project=/path/to/your/project
```

## 检查项

| 检查项 | 说明 | 等级 |
|--------|------|------|
| 🔴 Resource 类型安全 | $r() 赋值给 string 变量、=== 比较、fillText 传参等 | Error |
| 🟡 中文硬编码 | 页面文件中未被 $r 包裹的中文字符串 | Warning |
| 🟡 多语言资源完整性 | 页面引用的 app.string.xxx 是否在 zh_CN/ja_JP/en_US 中都定义 | Warning |
| 🟡 any 类型使用 | ArkTS 禁止 any 类型 | Warning |
| 🔴 .ts 导入 .ets | ArkTS 禁止跨后缀导入 | Error |

## 输出示例

```
📋 鸿蒙项目代码质量检查报告
═══════════════════════════════
📁 项目：wuwei
📄 扫描文件：48 个
   📂 entry/src/main/ets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 错误：0 项（必须修复）
⚠️  警告：61 项（建议修复）
   [RESOURCE] pages/AlarmRecordPage.ets:132
   ctx.fillText() 中使用了 $r('app.string.alarm_no_waveform')
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 避免的常见错误

详见 [Resource-国际化常见错误.md](./Resource-国际化常见错误.md)

## 项目结构

```
harmony-checker/
├── doclib/checker/
│   ├── check.mjs          # 检查工具主程序
│   └── HarmonyChecker.md   # 检查项说明文档
├── Resource-国际化常见错误.md  # 踩坑记录
└── README.md
```
