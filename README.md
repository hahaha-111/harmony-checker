# Harmony Checker 🐉

HarmonyOS ArkTS 代码质量检查工具。自动扫描项目中的多语言、Resource 类型、中文硬编码、API 13 严格模式等常见编译问题。

## 快速开始

```bash
npx harmony-checker --project=./my-harmony-app
# 或
node doclib/checker/check.mjs --project=/path/to/your/project
# 完整输出
node doclib/checker/check.mjs --project=/path/to/your/project --verbose
```

## 检查项

### 🔴 错误（必须修复）

| 检查项 | 说明 |
|--------|------|
| Resource 类型安全 | $r() 赋值给 string 变量、=== 比较、fillText 传参等 |
| .ts 导入 .ets | ArkTS 禁止跨后缀导入 |
| throw 任意类型 (arkts-limited-throw) | catch 块内 `throw e;` 需改为 `throw new Error(String(e))` |
| 未类型化对象字面量 (arkts-no-untyped-obj-literals) | Record<string,...> 拼装后传给特定 Interface API |

### 🟡 警告（建议修复）

| 检查项 | 说明 |
|--------|------|
| 中文硬编码 | 页面文件中未被 $r 包裹的中文字符串 |
| 多语言资源完整性 | 页面引用的 app.string.xxx 是否在 zh_CN/ja_JP/en_US 中都定义 |
| any 类型使用 | ArkTS 禁止 any 类型 |
| 已废弃 API | 旧 @ohos.xxx 模块路径、AlertDialog、decodeWithStream 等 |
| catch 类型标注 | catch(e: Error) 在 API 13 中不支持 |
| 未使用 catch 变量 | catch(err) {} 中 err 从未使用 → catch {} |
| Function may throw | fs.* / JSON.parse / Preferences 等未包裹 try-catch |
| await 非 Promise | 同步 API 前错误使用 await |
| 废弃全局 UI API | promptAction.showToast、router.pushUrl、getContext 等应使用 UIContext |
| List 组件宽高 | List() 缺少 .width()/.height() 初始化 |
| TextDecoder 废弃 | new util.TextDecoder() → util.TextDecoder.create() |
| 音频 ContentType 废弃 | CONTENT_TYPE_MUSIC 等已废弃，只传 usage 即可 |
| 未使用的导入 | import 了但从未使用的模块 |

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

详见踩坑记录：
- [Resource 国际化常见错误](./Resource-国际化常见错误.md)
- [HarmonyOS NEXT API 13 严格模式编译问题](./doclib/checker/HarmonyChecker.md)
- [wuwei IoT 项目实战踩坑记录](./doclib/wuwei-踩坑记录.md) — BLE/GATT、定时器生命周期、ArkTS 严格模式、协议解析、初始化顺序等 30+ 真实修复案例

## 项目结构

```
harmony-checker/
├── doclib/
│   ├── checker/
│   │   ├── check.mjs              # 检查工具主程序
│   │   └── HarmonyChecker.md       # 检查项说明文档
│   └── wuwei-踩坑记录.md          # wuwei IoT 项目实战踩坑记录
├── Resource-国际化常见错误.md       # 踩坑记录
└── README.md
```

## License

MIT
