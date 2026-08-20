# evo 开源设计理念

## 铁律（Iron Rule）

本项目是**个人开源项目**：仓库内（源码、文档、示例、测试、构建产物、发布包）**禁止出现任何公司信息与敏感信息**——公司名称/品牌/域名/邮箱、员工姓名与花名、内部系统代号、内网地址、机器绝对路径等。对外团队署名统一为 **Paper 团队（paper team）**，不出现任何公司身份。

本规则由 `scripts/iron-rule.mjs` 强制执行：`pnpm test` 对源码树检查，`pnpm check` 在构建后全仓（含 `dist/`）扫描，发现违规即失败。需要拦截的新模式请维护 `FORBIDDEN_PATTERNS` 列表。

## 项目目的

`evo` 是一个独立的 Agent 记忆与进化组件。它从回合经验中蒸馏记忆和可复用技能，并向不同 Agent 运行时提供检索、注入、整合和删除能力。

第一阶段只实现：

- Cordis 插件
- DeepSeek Harness adapter
- 默认的本地 SQLite 存储

Paper、Claude 和 Codex 适配器暂不属于第一阶段。

## 真指导文件

Evo 的语义、记忆分层、蒸馏方向和技能演化原则，以 `docs/reference/evo-reference.md` 为本阶段真指导文件。该文件是从 Paper 的 `design/evo-essay/evo.md` 拷贝的参考版本；实现细节可以演进，但不能悄悄改变其中的核心产品语义。

## 开箱即用与可替换

项目必须开箱即用：安装插件后，在没有额外配置时即可使用默认数据目录、默认 SQLite 存储和默认物化策略。

默认路径由运行时提供合理值，不写死为 Paper 的路径。例如，默认数据目录可以是平台数据目录下的 `evo` 子目录。用户可以通过配置或环境变量一次性改写数据目录、数据库文件和物化目标。

“开箱即用”与“可替换”同时成立：默认介质服务大多数用户，二次指定则允许换成其他存储介质，而不改变上层 Memory API。

## 接口与实现分离

核心逻辑只依赖抽象接口，不直接依赖 SQLite、Markdown、Paper、DeepSeek CLI 或 Cordis：

- `MemoryStore`：记忆的增删改查和按作用域替换
- `MemoryMaterializer`：将结构化记忆输出为 Markdown、JSON 或运行时上下文
- `ModelRunner`：执行反思和整合所需的模型调用
- `MemoryEventSink`：记录审计事件和状态变化

SQLite、Markdown、Cordis、DeepSeek 都是 adapter 或实现层。替换存储、模型或宿主运行时，不应迫使核心业务逻辑重写。

## 真源与物化

结构化存储是真源，Markdown、技能文件和提示词片段都是物化视图。物化器必须可重跑、可测试，并明确处理版本和冲突；外部宿主不应通过修改物化文件来绕过核心存储协议。

## 作用域

作用域使用结构化标识，而不是用特殊字符串哨兵模拟：支持 `global`、`user`、`project`、`session` 和 `conversation`，并允许 adapter 将宿主上下文映射到这些作用域。

## 演进顺序

先保证 DeepSeek Harness 中的记忆闭环可用，再逐步增加 Paper、Claude、Codex adapter。任何宿主适配都不能反向污染 `evo` core 的协议。
