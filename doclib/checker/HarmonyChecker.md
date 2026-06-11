# HarmonyOS ArkTS 项目代码质量检查工具

## 检查项清单

### 🔴 Resource 类型安全检查

扫描所有 .ets / .ts 文件，找出 $r('app.string.xxx') 在非安全位置的使用。

**不安全位置**（需用 getStringSync 转 string）：
- 赋值给 string 类型变量/属性
- === 比较
- ctx.fillText()
- promptAction.showToast()
- 自定义 Builder/函数的 string 参数
- TextInput({ text: Resource }) — text 是 string 类型

### 🟡 中文硬编码扫描

扫描所有页面文件，找出未被 $r 包裹的中文字符串。

### 🟡 多语言资源完整性检查

检查页面中 $r('app.string.xxx') 是否在 zh_CN/ja_JP/en_US/string.json 中都有定义。

### 🔴 常见编译错误检测

- any 类型使用（ArkTS 禁止）
- .ts 文件导入 .ets 文件
- Context 类型错误

### 🟡 已废弃 API 检测 (API 13 / API 20)

- **已废弃模块路径**（旧 @ohos.* -> 新 @kit.*）
  - @ohos.router -> @kit.ArkUI
  - @ohos.multimedia.media -> @kit.MediaKit
  - @ohos.multimedia.audio -> @kit.MediaKit
  - @ohos.promptAction -> @kit.ArkUI
- **已废弃 API 调用**：
  - AlertDialog.show/open -> promptAction.showDialog
  - DatePickerDialog.show/open -> promptAction.showDialog
  - fileIo.show / fs.show -> promptAction.showDialog
  - decodeWithStream -> decodeToString

### 🔴 catch 类型标注检测

ArkTS (API 13+) 不支持 catch 类型标注：
- catch (e: Error) -> catch (e)
- catch (e: any) -> catch (e)
- catch (e: unknown) -> catch (e)

### 🟡 未使用 catch 变量检测

- catch (err) {} -> catch {}
- catch (e) {} 但 e 从未使用 -> catch {}

### 🔴 "Function may throw" — try-catch 缺失检测

在 async 方法中，检测 fs.open() / fs.read() / fs.write() / fs.stat() / fs.close() / fs.mkdir() / fs.unlink() / fs.rename() / fileIo.* 等 API 是否被 try-catch 包裹。

### 🔴 throw 任意类型 (arkts-limited-throw)

检测 catch 块内 `throw e;` 的写法。ArkTS 禁止抛出 unknown 类型。

- `throw e;` → `throw new Error(String(e));`

### 🟡 await 非 Promise 值

检测对同步方法（如某些底层网络 API 或同步版 Preferences.put）的错误 await 使用。

### 🟡 未使用的变量/导入

- 声明了但 never read 的变量
- 未使用的 import 语句（_ 除外）

### 🟡 废弃全局 UI API (UIContext 多实例适配)

API 13 全面废弃全局静态方法，改由 UIContext 触发：

| 已废弃 | 替换方案 |
|--------|----------|
| `promptAction.showToast()` | `this.uiContext.getPromptAction().showToast()` |
| `router.pushUrl()` | `this.getUIContext().getRouter().pushUrl()` |
| `router.replaceUrl()` | `this.getUIContext().getRouter().replaceUrl()` |
| `router.back()` | `this.getUIContext().getRouter().back()` |
| `router.getParams()` | `this.getUIContext().getRouter().getParams()` |
| `getContext()` | `getHostContext()` / `this.getUIContext().getHostContext()` |

### 🟡 List 组件缺少宽高初始化

检测 List() 组件是否显式设置了 `.width()` 和 `.height()`。

### ⚠️ TextDecoder API 废弃

- `new util.TextDecoder('gbk')` → `util.TextDecoder.create('gbk')`
- `decodeWithStream(data)` → `decodeToString(data)`

### ⚠️ 多媒体音频 ContentType 废弃

- `audio.ContentType.CONTENT_TYPE_MUSIC` → 只需指定 usage
- `audio.ContentType.CONTENT_TYPE_RINGTONE` 等已废弃

### 🔴 未类型化对象字面量 (arkts-no-untyped-obj-literals)

禁止使用泛型字典（如 `Record<string, string>`）拼装参数后传给要求特定 Interface 的 API。

## 使用方法

```bash
node doclib/checker/check.mjs --project=/path/to/your/project
# verbose 输出完整报告
node doclib/checker/check.mjs --project=/path/to/your/project --verbose
```

## 输出示例

```
📋 鸿蒙项目检查报告
═════════════════════
📁 项目：my-app
📄 扫描文件：44 个
━━━━━━━━━━━━━━━━━━━
⚠️  警告：260 项（建议修复）
   ── DEPRECATED (8 项) ──
   [DEPRECATED] pages/MonitorPage.ets:1
   已废弃模块路径：@ohos.router
   修复：改用 { router } from '@kit.ArkUI'
   ...
```
