# evo-memory 存储架构

## 分层

```text
evo-memory core
├── MemoryItem / MemoryScope
├── MemoryStore
├── Reflector
├── Consolidator
├── MemoryMaterializer
└── MemoryEventSink

默认实现
└── SQLiteMemoryStore

宿主适配
├── CordisPlugin
└── DeepSeekAdapter
```

## 最小数据模型

记忆条目至少包含：稳定 ID、作用域、类型、标题、正文、标签、创建时间、更新时间、使用次数和来源。`skill` 可以作为一种记忆类型或后续扩展，但 Paper 的 `maturity` 等产品字段不进入核心必需协议。

## 存储接口

```ts
interface MemoryStore {
  list(query: MemoryQuery): Promise<MemoryItem[]>;
  get(id: string): Promise<MemoryItem | null>;
  put(item: MemoryItem): Promise<void>;
  delete(id: string): Promise<void>;
  replace(scope: MemoryScope, items: MemoryItem[]): Promise<void>;
}
```

第一版默认使用 SQLite，但路径由配置注入。核心不得读取 `~/.paper/slim.db`，也不得依赖 Paper 的 `cwd` 哨兵值。

## 默认路径策略

默认路径遵循宿主平台的数据目录约定，并使用 `evo-memory` 作为应用子目录。配置优先级建议为：显式运行时配置、环境变量、平台默认目录。路径解析属于 infrastructure 层，不能散落在 core 业务代码中。

## 物化策略

物化是可选能力。DeepSeek adapter 默认消费结构化注入片段；需要人类可读或宿主文件协议时，才启用 Markdown/JSON materializer。物化文件不能被视为跨宿主共享真源。
