# HarmonyOS ArkTS 项目代码质量检查工具

## 检查项清单

### 1. Resource 类型安全检查

扫描所有 `.ets` / `.ts` 文件，找出 `$r('app.string.xxx')` 在非安全位置的使用。

**安全位置**（接受 Resource 类型）：
- Text(Resource)
- Button(Resource)
- TextInput({ placeholder: Resource })
- Span(Resource)
- Image(Resource)
- SelectOption.value (Resource)
- Slider、Progress、LoadingProgress 等 ArkUI 组件

**不安全位置**（需用 getStringSync 转 string）：
- 赋值给 `string` 类型变量/属性
- `===` 比较
- `ctx.fillText()`
- `promptAction.showToast()`
- 自定义 Builder/函数的 string 参数
- `TextInput({ text: Resource })` — text 是 string 类型

### 2. 中文硬编码扫描

扫描所有页面文件，找出未被 `$r` 包裹的中文字符串。

### 3. 多语言资源缺失检查

检查页面中 `$r('app.string.xxx')` 是否在 `zh_CN/ja_JP/en_US/string.json` 中都有定义。

### 4. 常见编译错误检测

- `any` 类型使用（ArkTS 禁止）
- `.ts` 文件导入 `.ets` 文件
- Context 类型错误

## 使用方法

```bash
node /root/.openclaw/workspace/HarmonyDocTools/doclib/checker/check.js --project=<项目路径>
```

## 输出示例

```
📋 鸿蒙项目检查报告
═════════════════════
📁 项目：wuwei
📄 扫描文件：48 个
━━━━━━━━━━━━━━━━━━━
⚠️ [RESOURCE] 第3类错误：=== 比较中使用了 $r
   pages/HomePage.ets:459 — item.status === $r('app.string.home_connected')
   修复：改用 getStringSync 或字符串常量

⚠️ [I18N] 缺失 ja_JP 翻译
   app.string.home_device_kind_microwave_rx → 未在 ja_JP/string.json 中定义
━━━━━━━━━━━━━━━━━━━
 ✅ 通过 2 项  ⚠️ 警告 2 项  ❌ 错误 0 项
```
