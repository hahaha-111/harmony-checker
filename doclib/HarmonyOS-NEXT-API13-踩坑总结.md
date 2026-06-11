# HarmonyOS NEXT (API 13) 严格模式踩坑与修复指南

> 汇总在升级 HarmonyOS NEXT (API 13) 及使用 ArkTS 严格模式时，最常遇到的 Linter 警告、编译报错及运行时崩溃问题，提供标准化修复方案。

---

## 一、ArkTS 严格语法限制 (ArkTS Strict Mode)

### 1. 强制异常捕获

**警告信息：** `Function may throw exceptions. Special handling is required.`

**触发原因：** ArkTS 强制要求所有可能抛出异常的方法（如文件读写 `fs.*`、JSON 解析 `JSON.parse`、路由跳转 `router.pushUrl`、偏好设置存取 Preferences 等）必须显式处理异常。

**修复方案：** 使用 `try...catch` 包裹。注意：捕获到的异常变量 `e` 必须在作用域内被使用（例如打印日志），否则会触发 `never read` 警告。

```ts
// ❌ 错误：未捕获异常
const data = JSON.parse(str);

// ✅ 正确：严密包裹
try {
  const data = JSON.parse(str);
} catch (e) {
  console.error('Parse failed:', e);
}
```

### 2. 未使用的变量与导入（代码洁癖强制）

**警告信息：** `'xxx' is declared but its value is never read.` 或 `'Resource' is declared but never used.`

**触发原因：** 声明了变量、方法参数、或导入了模块，但在后续代码中没有任何一处读取过它。

**修复方案：** 坚决删除未使用的变量、参数和 import 语句。如果在回调函数中不需要使用的参数，直接移除参数声明。

```ts
// ❌ 错误
import { SomeType } from './types'; // SomeType 从未使用
import { unusedVar } from './utils';

// ✅ 正确：只导入实际使用的
import { usedFunction } from './utils';
```

### 3. 非 Promise 方法禁用 await

**警告信息：** `Unexpected 'await' of a non-Promise (non-"Thenable") value.`

**触发原因：** 在同步方法（如某些底层网络发送方法、或者某些版本的 Preferences.put 被同步化时）前面错误地使用了 `await` 关键字。

**修复方案：** 查阅 API 文档，如果方法返回值为 `void` 或具体类型而非 `Promise`，直接移除 `await`。

```ts
// ❌ 错误
await fs.mkdirSync('/data/storage');

// ✅ 正确
fs.mkdirSync('/data/storage');
```

### 4. 严苛的异常抛出限制

**报错信息：** `"throw" statements cannot accept values of arbitrary types (arkts-limited-throw)`

**触发原因：** 在 `catch(e)` 块中，`e` 的类型是 `unknown`。ArkTS 禁止直接 `throw e;`。

```ts
// ❌ 错误
catch (e) {
  throw e;
}

// ✅ 正确：包装为 Error 类型
catch (e) {
  throw new Error(String(e));
}
```

### 5. 禁用任意对象字面量动态传参

**报错信息：** `Object literal must correspond to some explicitly declared class or interface (arkts-no-untyped-obj-literals)`

**触发原因：** 试图用泛型字典（如 `Record<string, string | number>`）拼装参数，然后传给要求特定 Interface 的系统 API（如 `ShowToastOptions`）。

```ts
// ❌ 错误
const params: Record<string, string | number> = { message: '成功', duration: 2000 };
promptAction.showToast(params);

// ✅ 正确
promptAction.showToast({ message: '成功', duration: 2000 });
```

---

## 二、全局 UI API 废弃与多实例适配 (UIContext)

API 13 全面推行多窗口/多实例架构，所有曾经的"全局静态方法"全部被标记为 `@Deprecated`。

### 1. 废弃全局弹窗

**警告信息：** `The signature '(options: ShowToastOptions): void' of 'promptAction.showToast' is deprecated.`

```ts
// ❌ 废弃
promptAction.showToast({ message: '成功' });

// ✅ 推荐：在 ViewModel 中注入 UIContext 后使用
this.uiContext.getPromptAction().showToast({ message: '成功' });
```

### 2. 废弃全局路由

**警告信息：** `'pushUrl' / 'replaceUrl' / 'back' / 'getParams' has been deprecated.`

```ts
// ❌ 废弃
router.pushUrl({ url: 'pages/Index' });
const params = router.getParams();

// ✅ 推荐：使用 UIContext
this.getUIContext().getRouter().pushUrl({
  url: 'pages/Index'
}, router.RouterMode.Standard).catch(() => {});
const params = this.getUIContext().getRouter().getParams();
```

### 3. 废弃全局 Context 获取

**警告信息：** `'getContext' has been deprecated.`

```ts
// ❌ 废弃
const ctx = getContext(this);

// ✅ 推荐
const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
```

---

## 三、系统权限与安全组件陷阱

### 1. 用户授权 (user_grant) 的必填项报错

**报错信息：** `'reason'和'usedScene'属性是user_grant权限的必填项。`

**触发原因：** 在 `module.json5` 中申请了涉及隐私的权限（如定位、蓝牙），但没有提供申请原因和使用场景。

**修复方案：** 在 `module.json5` 中补全字段，并关联 `string.json` 资源。

```json
{
  "name": "ohos.permission.LOCATION",
  "reason": "$string:UseLOCATION",
  "usedScene": {
    "abilities": [ "EntryAbility" ],
    "when": "inuse"
  }
}
```

### 2. 剪贴板的高级安全限制与"假警告"

**现象：** IDE 疯狂报黄线警告 `To use this API, you need to apply for the permissions: ohos.permission.READ_PASTEBOARD`，但如果真的去 `module.json5` 申请了，打包真机安装时会报错 `install failed due to grant request permissions failed`。

**触发原因：** 读取剪贴板是受限的高危权限，普通应用无权申请。IDE 静态扫描仪只要看到 `.getData()` 就会无脑报警告。

**标准解法：** 绝对不要在 `module.json5` 中申请该权限。使用鸿蒙提供的安全控件 `<PasteButton>` 触发点击，系统会临时对你的应用放行。对于 IDE 的黄线警告，可以直接忽略，或在上一行添加 `// @ts-ignore` 屏蔽扫描仪提示。

---

## 四、核心组件与系统模块更新

### 1. List 组件的边界初始化

**警告信息：** `You are advised to initialize the width and height attributes of the List component.`

**触发原因：** ArkUI 渲染引擎为了极致性能，要求长列表控件必须具有明确的边界尺寸，否则在自适应撑开时会产生大量重绘计算。

```ts
// ❌ 未指定宽高
List() { ... }

// ✅ 显式添加宽高
List()
  .width('100%')
  .height('100%') { ... }
```

### 2. 文本编解码器 (TextDecoder) 废弃

**警告信息：** `The signature '(encoding?: string...)' of 'util.TextDecoder' is deprecated.`

```ts
// ❌ 废弃
const decoder = new util.TextDecoder('gbk');
let str = decoder.decodeWithStream(data);

// ✅ 推荐
const decoder = util.TextDecoder.create('gbk');
let str = decoder.decodeToString(data);
```

### 3. 多媒体音频流 ContentType 废弃

**警告信息：** `'CONTENT_TYPE_MUSIC' is deprecated.`

**修复方案：** API 10+ 后精简了音频参数配置，只需指定 `usage`（如 `audio.StreamUsage.STREAM_USAGE_ALARM`）即可，无需再指定废弃的 `contentType`。

```ts
// ❌ 废弃
audioRenderer.create({
  content: audio.ContentType.CONTENT_TYPE_MUSIC,
  usage: audio.StreamUsage.STREAM_USAGE_MUSIC
});

// ✅ 推荐
audioRenderer.create({
  usage: audio.StreamUsage.STREAM_USAGE_MUSIC
});
```

---

## 快速参考表

| 问题类型 | 错误/警告 | 修复方案 |
|---------|-----------|----------|
| 异常未捕获 | Function may throw | try-catch 包裹 |
| 未使用变量 | never read | 删除声明 |
| await 同步方法 | Unexpected await | 移除 await |
| throw unknown | arkts-limited-throw | `throw new Error(String(e))` |
| 字面量动态传参 | arkts-no-untyped-obj-literals | 直接用符合 Interface 的字面量 |
| 全局弹窗 | promptAction.showToast | UIContext.getPromptAction() |
| 全局路由 | router.pushUrl | UIContext.getRouter().pushUrl() |
| getContext | deprecated | getHostContext() |
| 权限理由缺失 | reason/usedScene 必填 | module.json5 补充 |
| 剪贴板权限 | READ_PASTEBOARD | 用 PasteButton 安全控件 |
| List 宽高 | advised to initialize | 添加 .width().height() |
| TextDecoder | deprecated | 用 .create() 工厂方法 |
| CONTENT_TYPE | deprecated | 只传 usage |

---

> 本文档适用于 HarmonyOS NEXT API 13 (API 13+) — 主推 ArkTS 严格模式版本。
> 对应检查工具：https://github.com/hahaha-111/harmony-checker
