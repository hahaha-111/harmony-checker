# wuwei IoT 监控 App 踩坑记录

基于 [hahaha-111/wuwei](https://github.com/hahaha-111/wuwei) 真实鸿蒙 IoT 项目的修复经验汇编。

## 目录

- [1. BLE/GATT](#1-blegatt)
- [2. 定时器生命周期](#2-定时器生命周期)
- [3. ArkTS 严格模式](#3-arkts-严格模式)
- [4. 编译与 SDK](#4-编译与-sdk)
- [5. 协议解析](#5-协议解析)
- [6. 数据流初始化](#6-数据流初始化)
- [7. 代码架构](#7-代码架构)
- [8. 废弃 API](#8-废弃-api)

---

## 1. BLE/GATT

### 1.1 BLE 写队列丢失（P0）

**现象**：连续写入 BLE 特征值时，后一个 write 覆盖前一个，导致命令丢失。

**根因**：使用简单的 `writeBusy` boolean 做流控，但在异步回调前第二个 write 已经开始。

```typescript
// ❌ 错误写法
private writeBusy: boolean = false;

async write(data: ArrayBuffer): Promise<void> {
  if (this.writeBusy) return;       // 直接丢弃！
  this.writeBusy = true;
  this.characteristic.write(data);  // 异步操作
}
```

**修复**：实现写队列 + `processWriteQueue()` 串行化。

```typescript
// ✅ 正确做法
private writeQueue: ArrayBuffer[] = [];
private writeBusy: boolean = false;

async write(data: ArrayBuffer): Promise<void> {
  this.writeQueue.push(data);
  if (!this.writeBusy) {
    this.writeBusy = true;
    this.processWriteQueue();
  }
}

private processWriteQueue(): void {
  if (this.writeQueue.length === 0) {
    this.writeBusy = false;
    return;
  }
  const data = this.writeQueue.shift()!;
  try {
    this.characteristic.write(data).then(() => {
      this.processWriteQueue();     // 写完再处理下一个
    });
  } catch (e) {
    console.error('write failed, retrying', e);
    this.writeQueue.unshift(data);  // 放回队头重试
    setTimeout(() => this.processWriteQueue(), 50);
  }
}
```

**工具检查**：在 ArkTS 文件中搜索 `writeBusy` 或 `writing` 标记 + `if` 判断的模式。

### 1.2 GATT 连接断开时定时器未清理（P0）

**现象**：断开 BLE 后，波形界面仍在发探针请求，导致 BLE 错误日志刷屏，甚至崩溃。

**根因**：`setConnected(false)` 没有停止波形定时器等计时器。

**修复**：在 setConnected 中：
- 连接时：启动 `startWaveUiTimer`
- 断开时：停止三个定时器 + 清空波形缓冲区

```typescript
public setConnected(isConn: boolean): void {
  this.isConnected = isConn;
  if (isConn) {
    this.startWaveUiTimer();
  } else {
    this.stopWaveCommandTimer();
    this.stopReconnectTimer();
    this.stopWaveUiTimer();
    this.clearWaveformBuffer();
  }
}
```

**工具检查**：对所有调用 `setTimeout`/`setInterval` 的页面类，检查 disconnect/onPageHide/aboutToDisappear 是否有对应的 `clearTimeout`。

---

## 2. 定时器生命周期

### 2.1 截图自动下载防抖（P0）

**现象**：报警恢复后，截图连续触发多次下载，每次弹 Toast 和保存对话框。

**根因**：`setTimeout` 前没有 `clearTimeout`，多个定时器重叠。

```typescript
// ❌ 错误写法
this.autoDownloadTimer = setTimeout(() => {
  this.downloadScreenshot();
}, 3000);
```

**修复**：设置新定时器前先清掉旧的。

```typescript
// ✅ 正确做法
if (this.autoDownloadTimer) {
  clearTimeout(this.autoDownloadTimer);
}
this.autoDownloadTimer = setTimeout(() => {
  this.downloadScreenshot();
}, 3000);
```

报警恢复时也要 cancel 掉。

### 2.2 定时器引用类型

**ArkTS 注意点**：`setTimeout` 返回 `number` 类型，检查 `if (timer)` 时 `timer = 0` 表示无效，不要用 `null`/`undefined`。

```typescript
private waveUiTimer: number = 0;   // ✅ number，不用 number | null
```

---

## 3. ArkTS 严格模式

### 3.1 Function may throw exceptions（API 13 新规）

**现象**：`fs.*`、`preferences.*`、`relationalStore.*` 等调用报 30+ 条警告。

**根因**：HarmonyOS API 13 强制要求所有可能抛出异常的系统 API 被 try-catch 包裹，否则编译警告。

**受影响的常见 API**：

| 模块 | 函数 | 修复方式 |
|------|------|---------|
| `@kit.CoreFileKit` | `fs.open` `fs.write` `fs.close` `fs.accessSync` `fs.mkdirSync` | 全部套 try-catch |
| `@kit.ArkData` | `preferences.get` `preferences.put` `preferences.flush` `preferences.getPreferences` | 全部套 try-catch |
| `@kit.ArkData` | `relationalStore.query` `relationalStore.delete` `relationalStore.insert` `resultSet.goToNextRow` `resultSet.get*` `resultSet.close` | 全部套 try-catch |
| `@kit.ArkUI` | `getUIContext().getPromptAction().showToast` | 即使已在 catch 内也需要嵌套 try-catch |

**参考修复模式**：

```typescript
// ✅ 标准模式
try {
  const file = await fs.open(path, fs.OpenMode.READ_WRITE);
  await fs.write(file.fd, content);
  await fs.close(file);
} catch (e) {
  console.error(`操作失败: ${path}, ${e}`);
}
```

```typescript
// ✅ 遍历 ResultSet 模式
try {
  const resultSet = await this.rdbStore.query(predicates);
  while (resultSet.goToNextRow()) {
    list.push({
      id: resultSet.getLong(resultSet.getColumnIndex('id')),
      content: resultSet.getString(resultSet.getColumnIndex('content')),
    });
  }
  resultSet.close();
  return list;
} catch (e) {
  console.error('query failed: ' + e);
  return [];
}
```

```typescript
// ✅ catch 内嵌 toast 模式
} catch (e) {
  if (this.uiContext) {
    try {
      this.getUIContext().getPromptAction().showToast({ message: '连接异常' });
    } catch (toastErr) {
      console.error('showToast失败: ' + toastErr);
    }
  }
}
```

### 3.2 catch 类型标注已废弃

**规则**：API 13 不支持 `catch(e: Error)`，改为 `catch(e)` + 内部 `as` 转换。

```typescript
// ❌ 错误
catch (err: BusinessError) { }

// ✅ 正确
catch (err) {
  const e = err as BusinessError;
}
```

### 3.3 throw 任意类型

**规则**：`catch` 块内 `throw e;` 会报 `arkts-limited-throw` 错误，需转为 `throw new Error(String(e))`。

```typescript
// ❌ 错误
catch (e) { throw e; }

// ✅ 正确
catch (e) { throw new Error(String(e)); }
```

---

## 4. 编译与 SDK

### 4.1 漏逗号（最常见低级错误）

**现象**：`',' expected` 编译错误。

**根因**：在对象字面量中添加新字段时漏写前一个字段后的逗号。

```typescript
// ❌ 错误
params: {
  deviceName: this.selectedDeviceName   // 漏了逗号！
  deviceAddress: this.detectedFiberAddress,
}
```

**预防**：在对象/数组的最后一个元素**也保留逗号**（trailing comma），后续添加新字段时不会漏。

### 4.2 `import` 未使用的警告

移除废弃 API 调用后，记得删掉对应的 `import`，否则编译报 unused import 警告。

### 4.3 跨后缀导入（.ts 导入 .ets 或反之）

**规则**：ArkTS 禁止 `.ts` 文件 `import` `.ets` 文件。同类后缀互相导入才是安全的。

### 4.4 未类型化对象字面量

**规则**：构造 `Record<string, ...>` 后传给需要特定接口类型的 API 时，需要显式声明类型。

---

## 5. 协议解析

### 5.1 协议解析器重复（P1）

**现象**：`LocalProtocolParser.ts` 和 `ProtocolParser.ts` 两份功能完全相同的解析器。

**根因**：历史遗留，在独立模块中复制了一份旧的协议解析逻辑。

**修复**：删除 `LocalProtocolParser.ts`（55 行），统一使用全局 `ProtocolParser`。

**检查**：`grep -r "class.*Parser" *.ts *.ets` 确保没有重复的 parser 类。

### 5.2 OTA 幽灵 ACK（P2）

**现象**：OTA 升级过程中，收到前一个包的延迟响应（幽灵 ACK），误触发状态机导致超时重试逻辑被跳过，升级永久挂起。

**根因**：MCU 协议 ACK 没有偏移量/序列号，仅靠包内容判断。40-60ms 内收到的 ACK 可能是上一个包的延迟响应。

```typescript
// ❌ 错误：clearTimeout 在外层，任何 ACK 都重置超时
switch (this.state) {
  case OtaState.SEND_DATA:
    if (isDataAck) {
      clearTimeout(this.ackTimeout);         // 可能清掉真正需要的超时
      this.retryCount = 0;
      this.sendNextPacket();
    }
}
```

**修复**（两处改动）：

1. **RTT 启发式过滤**：ACK 在 60ms 内到达则视为幽灵 ACK，直接忽略。

```typescript
private lastSendTime: number = 0;
private readonly GHOST_ACK_RTT = 60; // ms

// 发包时记录时间
this.lastSendTime = Date.now();

// 收包时检查
if (Date.now() - this.lastSendTime < this.GHOST_ACK_RTT) {
  console.debug('ghost ACK ignored');
  return;
}
```

2. **将 `clearTimeout` / `retryCount = 0` 移入每个 case 内部**

```typescript
// ✅ 正确：每个 case 自己管理超时
switch (this.state) {
  case OtaState.SEND_DATA:
    if (isValidAck()) {
      clearTimeout(this.ackTimeout);
      this.retryCount = 0;
      this.sendNextPacket();
      return;
    }
    break;
  case OtaState.WAIT_REBOOT:
    if (isRebootAck()) {
      clearTimeout(this.ackTimeout);
      this.retryCount = 0;
      this.finishOta();
      return;
    }
    break;
}
```

### 5.3 BLE 合并帧未解析

**现象**：`0x97` 电压数据全被丢弃，设备列表无电压显示。

**根因**：BLE 协议中长数据会被拆成多个帧发送，首个合并帧标记 `0xFF` 后跟长度，解析器未处理合并帧。

**修复**：在帧解析开始时检查 `0xFF` 前缀，累积完整 payload 后再触发协议解析。

---

## 6. 数据流初始化

### 6.1 光纤设备首屏无数据（P0）

**现象**：连接光纤设备 → 跳转波形界面 → 无数据 → 切到其他页面再切回来 → 数据正常。

**根因**：**两个问题叠加**：

**问题 A：设备地址传丢了**
- 扫描阶段遍历地址 0x00~0x0F 找到了光纤设备，frame.address 记录了地址
- 但 `handleDeviceDetectFrame` 只返回了设备类型，没有存储地址
- `navigateToMonitorPage` 的 params 没传 `deviceAddress` → 默认值 0x01 不对

```typescript
// ❌ 错误：找到了光纤设备但地址没传
private handleDeviceDetectFrame(frame: ProtocolFrame) {
  if (frame.deviceType === 0x66) {
    this.resolveDetectedKind('FIBER');
    // frame.address 丢了！
  }
}
```

```typescript
// ✅ 正确：记录地址并传递
private detectedFiberAddress: number = 0x01;

private handleDeviceDetectFrame(frame: ProtocolFrame) {
  if (frame.deviceType === 0x66) {
    this.detectedFiberAddress = frame.address;
    this.resolveDetectedKind('FIBER');
  }
}

// navigateToMonitorPage params 中传入
params: { ..., deviceAddress: this.detectedFiberAddress }
```

**问题 B：缺少初始化命令**
- `init()` 流程只启动了波形探针定时器（0xAA）
- 光纤设备需要收到 `readDeviceParams()`（0x15/0x03）才开始发送数据
- `onPageShow()` 有调 `readDeviceParams()` 但 `init()` 没有

```typescript
// ✅ 正确：init 中为光纤设备调用 readDeviceParams
init(): void {
  this.registerDataCallbacks();
  this.setConnected(true);
  if (this.deviceMode === 'FIBER') {
    this.readDeviceParams();   // 唤醒设备
  }
}
```

**检查清单**：
- ▢ `handleDeviceDetectFrame` 是否保存了 `frame.address`？
- ▢ `navigateToXX` 的参数是否包含 `deviceAddress`？
- ▢ `init()` 是否调用了必需的设备初始化命令？
- ▢ `onPageShow()` 和 `init()` 的初始化逻辑是否一致？

---

## 7. 代码架构

### 7.1 事件监听器泄漏（P1）

**现象**：多次打开/关闭蓝牙，回调函数被重复注册，导致回调被多次调用。

**根因**：`access.on('stateChange', callback)` 在调用前没有 `access.off('stateChange', ...)`。

```typescript
// ❌ 错误：每次注册都叠加一个新监听器
openBluetooth(): void {
  this.access.on('stateChange', this.onStateChange);
}

// ✅ 正确：注册前去注册旧的
openBluetooth(): void {
  this.access.off('stateChange', this.onStateChange);  // 先清理
  this.access.on('stateChange', this.onStateChange);    // 再注册
}
```

### 7.2 死代码（P2）

`OtaManager.ts` 全文件 93 行，零引用，零 import。

**检查**：定期运行 `grep -r "OtaManager" *.ts *.ets --include="*.ts" --include="*.ets"`。

### 7.3 文件命名语义化

`Index.ets` → `DebugPage.ets`：名称与实际用途不匹配的页面文件应重命名。

---

## 8. 废弃 API

### 8.1 promptAction.showToast

**API 13+ 废弃**：全局 `promptAction.showToast` 不再推荐，应使用 `uiContext` 的 `getPromptAction()`。

```typescript
// ❌ 废弃
import { promptAction } from '@kit.ArkUI';
promptAction.showToast({ message: '连接异常' });

// ✅ 新 API
this.getUIContext().getPromptAction().showToast({ message: '连接异常' });
```

**注意**：`getUIContext()` 本身也可能抛异常，需套 try-catch。

### 8.2 decodeWithStream

**API 13+ 废弃**：`TextDecoder.decodeWithStream(data)` → `TextDecoder.decodeToString(data)`。

```typescript
// ❌ 废弃
decoder.decodeWithStream(new Uint8Array(data));

// ✅ 新 API
decoder.decodeToString(new Uint8Array(data));
```

### 8.3 util.TextDecoder 构造

**废弃**：`new util.TextDecoder()` → `util.TextDecoder.create()`。

### 8.4 'showToast' deprecated 完全清单

| 位置 | 替换 | 说明 |
|------|------|------|
| SettingViewModel | `this.tipText = '消息'` | 如果页面有状态文本，直接赋值 |
| AlarmAnalysisPage | 嵌套 try-catch + `getUIContext().getPromptAction().showToast` | catch 块内也有 try-catch |

---

## 9. 一次性检查清单

编译前逐项核对：

### ArkTS 语法
- [ ] `catch(e: Error)` → `catch(e)` + `e as Error`
- [ ] catch 内 `throw e` → `throw new Error(String(e))`
- [ ] 对象字面量末尾逗号（推荐保留 trailing comma）
- [ ] `.ts` 和 `.ets` 不互相 import
- [ ] 删除废弃 API 后同步删 `import`

### 系统 API 异常处理
- [ ] `fs.*` 全部 try-catch
- [ ] `preferences.*` 全部 try-catch
- [ ] `relationalStore.*` + `ResultSet.*` 全部 try-catch
- [ ] `getUIContext().getPromptAction().showToast` 全部 try-catch

### BLE/GATT
- [ ] 写操作有队列，不用 boolean 互斥
- [ ] setConnected(false) 清理了所有定时器
- [ ] access.on 前有 access.off

### 定时器
- [ ] setTimeout 前有 clearTimeout（用于防抖）
- [ ] disconnect/onPageHide 清理了所有定时器
- [ ] 定时器 ID 类型为 `number`，用 `0` 表示无效

### 协议
- [ ] 没有重复的 Parser 类
- [ ] OTA ACK 处理有 RTT 过滤
- [ ] BLE 合并帧（0xFF 前缀）已解析

### 初始化
- [ ] 设备地址从扫描到导航页全程传递
- [ ] init() 调用了所有必需的设备初始化命令
- [ ] onPageShow 和 init 的初始化逻辑对称
