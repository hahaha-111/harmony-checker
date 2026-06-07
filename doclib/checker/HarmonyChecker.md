# HarmonyOS ArkTS 项目代码质量检查工具

## 检查项清单

### 1. Resource 类型安全检查

扫描所有 .ets / .ts 文件，找出 $r('app.string.xxx') 在非安全位置的使用。

**不安全位置**（需用 getStringSync 转 string）：
- 赋值给 string 类型变量/属性
- === 比较
- ctx.fillText()
- promptAction.showToast()
- 自定义 Builder/函数的 string 参数
- TextInput({ text: Resource }) — text 是 string 类型

### 2. 中文硬编码扫描

扫描所有页面文件，找出未被 $r 包裹的中文字符串。

### 3. 多语言资源缺失检查

检查页面中 $r('app.string.xxx') 是否在 zh_CN/ja_JP/en_US/string.json 中都有定义。

### 4. 常见编译错误检测

- any 类型使用（ArkTS 禁止）
- .ts 文件导入 .ets 文件
- Context 类型错误

### 5. 已废弃 API 检测 (API 20)

- **已废弃模块路径**（旧 @ohos.* -> 新 @kit.*）
  - @ohos.router -> @kit.ArkUI
  - @ohos.multimedia.media -> @kit.MediaKit
  - @ohos.multimedia.audio -> @kit.MediaKit
  - @ohos.promptAction -> @kit.ArkUI
- **已废弃 API 调用**：
  - AlertDialog.show/open -> promptAction.showDialog
  - DatePickerDialog.show/open -> promptAction.showDialog
  - fileIo.show / fs.show -> promptAction.showDialog
  - decodeWithStream -> decode

### 6. catch 类型标注检测

ArkTS SDK 6.0.0 (API 20) 不支持 catch 类型标注：
- catch (e: Error) -> catch (e)
- catch (e: any) -> catch (e)
- catch (e: unknown) -> catch (e)

### 7. 未使用 catch 变量检测

- catch (err) {} -> catch {}
- catch (e) {} 但 e 从未使用 -> catch {}

### 8. "Function may throw" — try-catch 缺失检测

在 async 方法中，检测 fs.open() / fs.read() / fs.write() / fs.stat() / fs.close() / fs.mkdir() / fs.unlink() / fs.rename() / fileIo.* 等 API 是否被 try-catch 包裹。

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
📁 项目：wuwei
📄 扫描文件：44 个
━━━━━━━━━━━━━━━━━━━
⚠️  警告：260 项（建议修复）
   -- DEPRECATED (8 项) --
   [DEPRECATED] pages/MonitorPage.ets:1
   已废弃模块路径：@ohos.router
   修复：改用 { router } from '@kit.ArkUI'
   ...
```