# 侧边栏面板注入方案设计：统一面板宿主（插件侧） + 官方槽位路线（上游侧）

**日期**：2026-08-19
**状态**：评审中（设计文档先行，实现待批准）
**作者**：DSH 工程模式会话
**当前版本**：v0.13.0（main）
**目标版本**：v0.13.x（不 bump 大版本）

## 1. 目标

1. 解决侧边栏面板的**注入方法**问题：找到一个同时兼容「纯浏览器 / Electron 套壳（DSH Desktop）/ 各类 Tauri/WebView 套壳 / 移动 webview」且**性能良好**的统一注入方案。
2. 消灭现有症状级补丁 PR 簇（#226 desktop 布局推挤、#135 dsh-web-mobile、#82/#108/#111/#138/#153 桌面标题栏）背后的结构性根因：**插件选择器深入宿主 DOM 形状 + 桌面壳依赖手动设置 + 拖拽期整壳 layout + 懒加载缓存每次激活全清**。
3. 探索并文档化「官方槽位路线」：参考 DSH 内置插件 `ui-sidebar`（官方左侧边栏本身就是以插件方式占用 `sidebar` 槽），评估外部插件接管官方面板槽的可行性与代价，作为中期北极星；上游未落地前以插件侧方案为主线。

## 2. 非目标（Out of Scope）

- **不修改 DSH 官方源码**（仓库硬约束，`~/.dsh/source/current` 零写入）；官方槽位路线只产出 issue/设计建议给上游。
- 不做 shadow DOM / iframe 全隔离注入（令牌穿透、事件与 portal 代价高，仅在宿主样式污染实测出现时作为兜底启用）。
- 不重构 tab/viewer 扩展点本身（`ctx.betterSidebar` 服务契约不变）。
- 不承诺禁用官方 `ui-sidebar` 的行为由插件自动完成——那是 **profile 层用户决策**，插件只文档化。
- 不处理 #69（browser 探测，独立域）。

## 3. 已验证事实（证据先行，2026-08-19 核对）

### 3.1 当前注入实现（本仓库）

| 事实 | 证据 |
|---|---|
| 注入 = body 直下 `div[data-dsh-better-sidebar]` + **第二个 React root**（非 portal） | `src/client/index.tsx:120-141` |
| 宿主推挤 = html 上 `--dsh-sidebar-width/height` + `#root{margin-right}` + **`#root > [data-slot=root] > div > div:nth-child(2)` 锚点** | `src/client/layout.css:22-32` |
| 拖拽：pointer 事件 + rAF 单帧写面板尺寸与 html 变量（无强制 reflow 读） | `src/client/Sidebar.tsx:494-518` |
| 懒加载 chunk：**每次激活 `resetChunks()` 全清内存缓存**（HMR 安全但二次打开重拉脚本） | `src/client/index.tsx:120` 注释、`chunk-loader.ts` |
| 会话切换：只换 snapshot，面板 DOM 不重建（保持） | `Sidebar.tsx` store 驱动 |

### 3.2 DSH 官方架构（`~/.dsh/source/current`，只读）

| 事实 | 证据 |
|---|---|
| 外壳 = `#root` 单挂载点 + `__DSH_BOOT__` 引导；真实 UI 树全挂在 `root` 槽 | `apps/web/index.html:10-12`、`packages/client/web/src/app.tsx:38-43` |
| `ui-layout` 声明 `root` 槽的 children：`sidebar`/`conversation`/`details` 三个 **single 独占槽**；single 槽重复声明**抛错** | `ui-layout/src/client/index.ts:80-96`、`ui-slots/src/index.ts:747` |
| **官方左侧边栏 = 内置插件 `ui-sidebar`**：注册 `name:'sidebar'`，渲染在 AppFrame 的 grid 列内；几何经 layout store → `gridTemplateColumns` 内联传导（非 CSS 变量）；**官方不持久化宽度/折叠**；折叠按钮在 SidebarRoot 内自渲染并调 `ctx.layout.toggleSidebar()`；拖拽把手由 AppFrame 免费提供 | `ui-sidebar/src/client/index.ts:39`、`ui-layout/src/client/AppFrame.tsx:164-196` |
| `details` 槽（右侧面板）被 `ui-conversation` 的 DetailsPanel 占用；禁 ui-conversation = 会话列整体空置，代价极高 | `ui-conversation/src/client/apply.ts:445-458` |
| 官方浮层（Menu/Modal/Toast/HoverCard）全部 `createPortal(document.body)`——**body 级 portal 是官方姿势** | `ui-primitives/Menu.tsx:299`、`Modal.tsx:55-85` |
| 槽位注入消费者经 `slots.inject` 注入；槽未声明时**静默跳过**（禁用 ui-sidebar 不会炸树，但接管者需自实现会话/设置入口） | `runtime/src/client/slots.ts:130-192` |
| profile 可禁用内置插件行：`cordis.patch.yml` `- id: <plugin-id>` + `disabled: true`（皮肤 10 款禁用先例） | `~/.dsh/profiles/web/cordis.patch.yml` |
| 性能参考：拖拽 rAF 合并最新 delta 单帧应用 + `[data-dragging]` 禁过渡 + 纯函数让步结算 + 「关闭=宽 0 保活不卸载」 | `AppFrame.tsx:59-62`、`AppFrame.module.css:8-17`、`columns.ts:62-77` |

### 3.3 桌面套壳（本机 DSH Desktop.app，Electron）

| 事实 | 证据 |
|---|---|
| 渲染 URL 注入信号：`?dsh-desktop-mode=<compatibility\|advanced>&dsh-desktop-platform=<…>` | `app.asar.unpacked/lib/src-B5373ech.js` |
| win32：`titleBarStyle:"hidden"` + `titleBarOverlay({height:32})`（右上角 32px 为窗口控制钮） | `electron-runtime-C_i38SKA.js:338-348` |
| darwin：`titleBarStyle:"hiddenInset"` + `trafficLightPosition(16,16)`（左上红绿灯区 ~78px） | 同文件 `:325-333` |
| 安全基线：`contextIsolation/sandbox:true`、`nodeIntegration:false`；preload 仅暴露 `__DSH_DESKTOP_FILE_PATH__` | `preload.cjs:5-9` |
| 社区 Tauri 套壳（kyorakuyk/dsh-desktop、Lotus-c/DSH-Desktop）用**原生系统标题栏**，fixed 语义与纯浏览器一致 | 子代理调研（来源 URL 见 §10） |
| 套壳最大注入风险：祖先 `transform/will-change` 劫持 fixed 包含块、标题栏 overlay 遮顶、drag 区吞事件、移动键盘盖 `bottom:0` | 子代理调研 |

## 4. 方案总览：双路线

```
路线 A（主线，本仓库可控）┐
  统一面板宿主：body 固定含块包裹层            ├─ 现在 → v0.13.x
  + 桌面信号自动适配 + rAF 几何批处理           │
路线 B（北极星，依赖上游）┘
  ui-sidebar 模式：占用官方槽位（grid 内渲染） ─ 上游落地后 → 迁移（浮层部分保留）
```

- **路线 A 立即做**：不依赖 DSH 新能力，纯插件侧，直接吸收桌面/移动/性能问题。
- **路线 B 并行提官方 issue**：请求上游提供「可替换/可接管的右侧面板槽」（details 支持外部替换或新增 bottom-panel 槽），落地后 better-sidebar 主体迁入 grid，body 浮层收敛为纯浮层（菜单/弹窗/右键，与官方 ui-primitives 同姿势）。

## 5. 路线 A 详细设计：统一面板宿主

### 5.1 挂载层（兼容性根因修复）

**A1.1 固定含块包裹层**：保留 body 级锚点（官方 portal 姿势），但结构升级为：

```
document.body
└─ div[data-dsh-better-sidebar]           ← 唯一锚点（属性不变，兼容既有契约/皮肤）
   └─ div[data-dsh-panel-host]            ← 新增：position:fixed; inset:0; pointer-events:none; z-index:40
      ├─ 右侧面板（absolute; right:0; pointer-events:auto）
      └─ 底部面板（absolute; bottom:0; pointer-events:auto）
```

- 面板在**自己的固定含块**内 absolute 定位 → 宿主中间层（套壳注入的 wrapper）transform 不再劫持面板 fixed 语义。
- 折叠按钮簇 z-index 45 不变（skin 契约 §8 同步）。
- **挂载自检（一次）**：挂载后对比 `getBoundingClientRect()` 与 `window.innerWidth/Height`；若 html/body 本身被套壳 transform/偏移（罕见），自动降级为「absolute + 每帧 rAF 同步宿主 rect」模式并 console.warn 一次。
- **MutationObserver 守卫（默认开，可关）**：body childList 变化检测锚点被宿主清空/挪位时自动重挂（SPA 导航/套壳重排兜底）；观察器廉价（仅 childList、无 subtree）。

**A1.2 桌面信号自动探测**（替代手动 titleBarCompat）：

- 信号源：URL `dsh-desktop-mode` / `dsh-desktop-platform`（Electron 官方注入）+ `window.__DSH_DESKTOP_FILE_PATH__` 存在性（preload 标记）+ UA 兜底。
- 适配表：

| 探测结果 | 自动适配 |
|---|---|
| win32 + advanced | 右上角保留 32px 标题栏 overlay 区：折叠按钮簇/设置按钮下移，面板顶部内边距 +32px |
| darwin | 左上角保留 ~78px 红绿灯区：左侧贴边控件（若存在）避让 |
| compatibility / 无信号 | 原生 frame，不避让（现状行为） |
| 移动 webview | 窄屏 overlay 抽屉 + `visualViewport` 键盘监听 + `env(safe-area-inset-*)` 内边距 |

- 保留现有手动开关（titleBarCompat）作为覆盖位，但默认值改为「自动」。

**A1.3 移动端**：窄屏（断点沿用 `breakpoints.ts`）面板从「推挤宿主」切「overlay 抽屉」：不写 `#root` margin、面板 transform 滑入滑出；`visualViewport` 变化（键盘弹起）时底部面板上移。

### 5.2 几何层（性能）

**A2.1 单一 rAF 几何写入器**：所有尺寸变更（拖拽/折叠/会话恢复/宿主尺寸变化）汇聚到一个函数，**一帧内一次写**：面板 inline 尺寸 + html `--dsh-sidebar-width/height` + `#root` margin。杜绝多帧多次写导致的级联 layout。

**A2.2 拖拽**（对齐官方 AppFrame 模式）：

- pointer capture + 只存最新 delta + 单帧 rAF 应用（现状已满足，保留）；
- 拖拽期 `body[data-dsh-sidebar-dragging]` 禁过渡（`layout.css:49` 已有，保留）；
- 拖拽期面板根挂 `will-change: transform`（仅拖拽期，结束移除）；面板根常驻 `contain: layout style` 隔离内部布局。

**A2.3 chunk 缓存修复**：`resetChunks()` 从「每次激活全清」改为「按 chunk 名 + 内容哈希缓存，仅 HMR（fiber 重挂 + 版本变化）失效清」——二次打开懒加载 tab 直接命中缓存，不重拉脚本。

**A2.4 保活策略（保持现状并文档化）**：面板 DOM 跨会话不重建；tab 内容按 `visible` prop 懒挂载/卸载；树/终端等重组件不随会话切换重挂。

### 5.3 契约层（可维护性）

- **锚点弱化**：`layout.css:31` 的 `#root > [data-slot=root] > div > div:nth-child(2)` 替换为 `:has()`/数据属性弱锚定；推挤逻辑收敛进几何写入器（一处实现）。
- **推挤可关闭**：`SidebarPrefs` 新增（或复用既有）「宿主推挤」开关，默认开；桌面套壳/移动端自动切 overlay 时关闭推挤（修 #226 根因：不再依赖 `#root{width:100%}` 之外的宿主形状）。
- **契约文档化**：挂载点（`data-dsh-better-sidebar` / `data-dsh-panel-host`）、z-index 栈、CSS 变量（`--dsh-sidebar-width/height` 保持对外）、桌面信号（URL/全局标记）、推挤锚点策略 —— 同步 AGENTS.md §8 与本文档。
- **服务契约不变**：`ctx.betterSidebar` API 零变化；#135 的 service 读取问题（dsh-web-mobile 下 `ctx.betterSidebar` 直接读抛错）由「注入层与服务的解耦」顺带收敛（面板渲染不再假设服务存在即可读）。

### 5.4 性能清单（验收口径）

| 指标 | 现状 | 目标 |
|---|---|---|
| 拖拽期宿主 layout 次数 | 每帧 ≥1 次整壳 layout（margin 写 + 变量写分帧） | 每帧 1 次、单次批写；拖拽 0 次 reflow 读 |
| 懒加载 chunk 二次打开 | 每次激活重拉脚本 | 缓存命中 0 网络 |
| 会话切换 | 面板 DOM 不重建（已满足） | 保持 + 重组件懒挂载 |
| 面板显隐动画 | transform+width/margin 过渡 | transform 优先（overlay 模式），推挤模式过渡保留 |
| 观察器 | 常驻双观察器 | 合并为 rAF 节流单观察器（对齐 AppFrame:110-128） |

## 6. 路线 B 详细设计：官方槽位迁移（ui-sidebar 模式）

### 6.1 可行性结论（已验证）

- **`sidebar` 槽：可接管**。条件：profile 层 `cordis.patch.yml` 禁用 `ui-sidebar`（`disabled: true`），`ui-layout` 必须保留；接管者需自实现 `sidebar.workspaces`/`sidebar.settings` 子槽内容或留空（`slots.inject` 静默跳过，不炸树）；折叠按钮自渲染 + `ctx.layout.toggleSidebar()`；宽度/折叠持久化**自做**（官方不持久化）。
- **`details` 槽：不可行（当前）**。唯一占用者 ui-conversation 的 DetailsPanel 与其会话 UI 同包，禁用即空置会话列；需上游把 DetailsPanel 拆为可替换槽位或提供优先级机制。
- **几何传导**：槽位渲染在 AppFrame grid 列内，官方拖拽把手/折叠/让步结算免费生效；session scope 槽的 sessionId 由框架注入为标准 prop。

### 6.2 上游 issue 建议（本仓库只出建议，不改源码）

1. 将 `details` 槽的占用者改为**可替换**（如 single 槽支持「替换注册」或 DetailsPanel 拆独立包），使外部插件能接管右侧面板。
2. 新增（或声明）`bottom-panel` 槽，供底部面板类插件使用。
3. ui-sidebar 宽度/折叠持久化下沉到 layout store（官方侧目前不持久化）。

### 6.3 迁移路径（上游落地后）

1. better-sidebar 增加「槽位渲染后端」：注册 `details`/`bottom-panel` 槽，`Sidebar` 树渲染进 grid（同一套 store/组件，仅挂载点不同）。
2. body 浮层收敛为纯浮层：菜单、弹窗、右键、拖出浮窗（与官方 ui-primitives portal 同姿势）。
3. 保留路线 A 的固定含块层作为浮层宿主；推挤/几何写入器退役（grid 接管）。

### 6.4 收益与代价

| 收益 | 代价 |
|---|---|
| 零 body 注入、零宿主 DOM 依赖 | 契约绑定上游 SlotMap，DSH 升级需跟随 |
| 官方几何/拖拽/折叠/让步结算免费 | 官方不持久化宽度，需自做持久化 |
| 任何套壳天然一致（grid 与套壳无关） | 上游排期不可控（issue 周期） |
| 拖拽性能与官方同源 | 迁移期间双后端并存（维护成本） |

## 7. 兼容矩阵（注入策略 × 场景）

| 场景 | body 固定含块（路线 A） | 官方槽位（路线 B） | shadow DOM | iframe |
|---|---|---|---|---|
| 纯浏览器 | ✅ 推荐 | ✅ | ✅（令牌穿透） | ⚠️ 令牌/交互断裂 |
| Electron 套壳（DSH Desktop） | ✅ + 信号自动避让 | ✅ | ✅ | ⚠️ |
| Tauri 套壳（原生标题栏） | ✅ | ✅ | ✅ | ⚠️ |
| 移动 webview | ✅ + overlay 抽屉/visualViewport | 需上游槽位 | ✅ | ⚠️ |
| 页面内嵌 iframe | ⚠️ 需宿主放行 | ❌ | ✅ | ✅（天然隔离） |
| 祖先 transform 劫持 | ✅ 自检降级 | ✅ 天然免疫 | ✅ | ✅ |
| 性能（拖拽/显隐） | rAF 批写 + contain | 官方 grid | 中 | 低 |

## 8. 实施拆分与验证

### 8.1 拆分

- **PR1（核心注入 + 性能）**：5.1 挂载层（含块包裹层 + 自检降级）+ 5.2 几何层（rAF 写入器 + chunk 缓存）+ 5.3 锚点弱化；外部契约（CSS 变量/锚点属性/服务 API）零变化，CI 全绿。
- **PR2（桌面/移动自动适配 + 契约文档）**：5.1.2 桌面信号探测 + 5.1.3 移动端 overlay + 推挤可关闭 + AGENTS.md §8/本文档同步。
- **PR3（可选）**：路线 B 上游 issue 提交 + 槽位渲染后端原型（feature-flag 后）。
- 各 PR 独立可验证；PR1 不依赖 PR2。

### 8.2 验证

- **单元**：几何写入器 rAF 批处理（fake timers 断言单帧单写）；桌面信号解析（URL param × platform × 全局标记）；挂载自检降级路径；chunk 缓存命中/失效。
- **e2e**：`tests/e2e/mount.e2e.ts` 深扫保持不变并新增断言：`data-dsh-panel-host` 存在、锚点属性不变；新增 desktop-mode URL 参数场景（模拟 win32 advanced → 顶栏避让类生效）。
- **skin 契约**：`tests/theme.spec.ts` 令牌读取不变（§8 契约同步守护）。
- **CI**：全绿门禁（build/typecheck/test/consumer-types/plugin-mount）；#180 的 plugin-mount flake 与本次改动无关，重跑确认。
- **度量**：拖拽期 PerformanceObserver 记录 layout 次数；懒加载二次打开网络计数为 0。

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 固定含块改变既有 fixed 行为（罕见宿主） | 挂载自检 + 降级模式；锚点属性/CSS 变量不变，可一键回退旧实现 |
| 几何写入器集中化引入回归 | PR1 内保留旧写入路径开关（feature-flag），e2e 深扫覆盖 |
| 桌面自动探测误判（套壳改 URL 格式） | 信号解析白名单 + 手动覆盖位保留 |
| 路线 B 上游不落地 | 路线 A 完整自洽，不阻塞 |
| 禁用 ui-sidebar 属 profile 用户决策 | 插件仅文档化，不自动执行 |

## 10. 参考来源

- DSH 源码：`~/.dsh/source/current`（只读）：`ui-layout/src/client/{index.ts,AppFrame.tsx,columns.ts,stores.ts,AppFrame.module.css}`、`ui-slots/src/index.ts`、`ui-sidebar/src/client/index.ts`、`ui-conversation/src/client/apply.ts`、`ui-primitives/Menu.tsx`、`runtime/src/client/slots.ts`
- DSH Desktop 运行时（本机 .app，只读）：`lib/src-B5373ech.js`、`lib/electron-runtime-C_i38SKA.js`、`lib/preload.cjs`
- 社区套壳：kyorakuyk/dsh-desktop（https://github.com/kyorakuyk/dsh-desktop）、Lotus-c/DSH-Desktop（https://github.com/Lotus-c/DSH-Desktop）
- 本仓库：`src/client/index.tsx`、`src/client/Sidebar.tsx`、`src/client/layout.css`、`docs/plans/2026-08-15-skin-compat-design.md`
- 相关 PR：#226、#135、#82、#108、#111、#138、#153（症状级补丁，本方案吸收其目标）；#208/#90（issue）

## 11. 决策记录与实施偏差记录

- 2026-08-19：方案定稿——路线 A（统一面板宿主）为主线、路线 B（官方槽位）并行提 issue；先出设计文档，实现拆 PR1/PR2 待批准。
- 实施偏差记录：待实施时按既有文档惯例补充。
