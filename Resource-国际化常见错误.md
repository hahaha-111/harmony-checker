# 鸿蒙 ArkTS 多语言国际化（$r Resource）常见错误

> 2026-04-30 记录自 wuwei 项目编译错误修复经验

## 错误类型 & 修复方案

### 错误 1：Resource 赋值给 string 类型变量

**报错：**
```
Argument of type 'Resource' is not assignable to parameter of type 'string'
Type 'Resource' is not assignable to type 'string'
```

**原因：** `$r('app.string.xxx')` 返回 `Resource` 类型，但赋值给 `string` 类型变量。

**错误代码：**
```ts
this.vm.message = $r('app.string.debug_send_mode_text');  // ❌ vm.message 是 string
this.vm.connectStateText = $r('app.string.connect_state_not_connected');  // ❌
```

**修复：**
```ts
// 用 getContext(this).resourceManager.getStringSync(Resource) 转 string
this.vm.message = getContext(this).resourceManager.getStringSync(
  $r('app.string.debug_send_mode_text')
);
```

**适用场景：** `vm.message`、`vm.xxxText`、`vm.connectStateText` 等 string 类型 ViewModel 属性。

### 错误 2：string 类型函数参数传了 Resource

**报错：**
```
Argument of type 'Resource' is not assignable to parameter of type 'string'
```

**原因：** 自定义 Builder/函数参数声明为 `text: string`，但传入了 `$r(...)`。

**错误代码：**
```ts
@Builder function TabButton(text: string, ...) { ... }
// 调用
TabButton($r('app.string.xxx'), ...)  // ❌

@Builder navItem(title: string, index: number) { ... }
this.navItem($r('app.string.xxx'), 0);  // ❌
```

**修复方案 A（推荐）：扩展参数类型**
```ts
@Builder function TabButton(text: Resource | string, ...) { ... }
// 或
@Builder navItem(title: Resource | string, index: number) { ... }
```
> 内部用 Button(text) 或 Text(text)，ArkUI 原生组件都接受 `Resource | string`

**修复方案 B：调用处提前转 string**
```ts
const ctx = getContext(this);
TabButton(ctx.resourceManager.getStringSync($r('app.string.xxx')), ...)
```

### 错误 3：Resource 与 string 做 === 比较

**报错：**
```
This comparison appears to be unintentional because the types 'string' and 'Resource' have no overlap
```

**原因：** 把 `$r()` 的返回值与 `string` 类型的变量用 `===` 比较，类型完全不同。

**错误代码：**
```ts
// item.status: string
item.status === $r('app.string.home_connected')  // ❌ 类型不匹配
item.status === $r('app.string.setting_reading')  // ❌

// 或者用 || 判断
const finalName = (this.vm.deviceName !== $r('app.string.setting_reading') && ...)  // ❌
```

**修复：改用字符串常量比较**
```ts
item.status === '已连接'  // ✅ 直接用文本常量
// 或预存变量
const connectedText = getContext(this).resourceManager.getStringSync($r('app.string.home_connected'));
// ...
item.status === connectedText
```

> ⚠️ 注意：如果 item.status 来自服务端/设备端，它的值不可能通过 `$r` 动态切换语言。所以用字符串常量比较是正确的做法。

### 错误 4：fillText 传了 Resource

**报错：**
```
Argument of type 'Resource' is not assignable to parameter of type 'string'
```

**原因：** Canvas `ctx.fillText()` 接受 `string | number`，不能传 `Resource`。

**错误代码：**
```ts
ctx.fillText($r('app.string.alarm_no_waveform'), w / 2, h / 2);  // ❌
```

**修复：**
```ts
const text = getContext(this).resourceManager.getStringSync(
  $r('app.string.alarm_no_waveform')
);
ctx.fillText(text, w / 2, h / 2);  // ✅
```

### 错误 5：Resource 数组赋值给 string 数组 / 传 string 参数

**报错：**
```
Argument of type 'Resource' is not assignable to parameter of type 'string'
```

**原因：** `const arr = [$r(...), ...];` 类型被推断为 `Resource[]`，但被用在需要 `string` 的地方。

**错误代码：**
```ts
const DEVICE_TYPE_OPTIONS = [
  $r('app.string.device_kind_microwave_rx'),  // Resource
  $r('app.string.device_kind_microwave_tx'),   // Resource
];  // 类型：Resource[]
// ...
const type = DEVICE_TYPE_OPTIONS[index];  // type: Resource
addLocalDevice(name, ip, port, type);  // ❌ type 参数期望 string
```

**修复：用字符串数组**
```ts
const DEVICE_TYPE_OPTIONS = [
  '微波接收',        // ✅ string
  '微波发射',
];
// SelectOption 的 value 也接受 string
Select(DEVICE_TYPE_OPTIONS.map(v => ({ value: v } as SelectOption)))
```

> 如果需要 `Select` 下拉框的选项跟随语言切换，改为在 `@State` 中用动态资源：
> ```ts
> @State deviceOptions: Resource[] = [
>   $r('app.string.home_device_kind_microwave_rx'), ...
> ];
> ```

## 安全规则总结

| 使用位置 | `$r(Resource)` 是否安全 |
|---------|----------------------|
| `Text('xxx')` → `Text($r('app.string.xxx'))` | ✅ 安全 |
| `Button('xxx')` → `Button($r('app.string.xxx'))` | ✅ 安全 |
| `TextInput({ placeholder: $r(...) })` | ✅ 安全 |
| `promptAction.showToast({ message: $r(...) })` | ❌ 必须用 getStringSync 转 |
| `SelectOption.value` | ✅ 安全（接受 Resource） |
| `ctx.fillText($r(...))` | ❌ 必须用 getStringSync 转 |
| `vm.message = $r(...)` | ❌ 必须用 getStringSync 转 |
| `item.status === $r(...)` | ❌ 用字符串常量 |
| 自定义函数参数 | 扩展为 `Resource \| string` |
| `Picker` / `DatePickerDialog` | 各有单独规则 |

## 通用修复工具函数

```ts
// 组件内获取字符串值的辅助方法
private getString(res: Resource): string {
  return getContext(this).resourceManager.getStringSync(res);
}

// 用法
const text = this.getString($r('app.string.xxx'));
```
