# 微习 Microly

一款面向碎片时间的技能微学习应用。

> 每天 3 分钟，练会一个小技能。

## 工程结构

本仓库使用 pnpm Monorepo 管理三个独立应用：

```text
apps/
├── miniapp/   # Taro 4 + React 微信小程序与 H5
├── api/       # Fastify + TypeScript API
└── admin/     # Vite + React + TypeScript 运营后台
packages/
└── content-schema/ # 基于 Zod 的训练内容共享契约
```

小程序已包含“边界沟通”本地课程，提供拒绝临时任务、协商任务优先级和管理交付时间预期三组训练，以及今日调度、课程进度、单组重练和本地错题复习；API 和运营后台仍为 Hello World 工程。API 已安装 Zod、Drizzle ORM 和 PostgreSQL 驱动，但尚未配置数据库连接、Schema 或迁移。

## 环境要求

- Node.js 22 或更高版本
- pnpm 11.15.1
- 微信开发者工具（运行小程序时需要）

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

仓库只维护根目录的一份 `pnpm-lock.yaml`。

## 本地开发

### 微信小程序

```bash
pnpm dev:miniapp
```

构建产物位于 `apps/miniapp/dist`。微信开发者工具应打开 `apps/miniapp` 目录。

共享测试号 AppID 配置在 `apps/miniapp/project.config.json`，微信开发者工具打开 `apps/miniapp` 后会直接使用该测试号。

小程序环境变量统一放在 `apps/miniapp`。如需临时切换 Taro 构建产物使用的 AppID，可创建不会被 Git 跟踪的 `apps/miniapp/.env.development.local`：

```dotenv
TARO_APP_ID=wx你的测试号AppID
```

修改后需要重新启动 `pnpm dev:miniapp`。`TARO_APP_ID` 会覆盖构建产物 `apps/miniapp/dist/project.config.json`，但不会改写受版本控制的外层 `project.config.json`；不要在前端环境文件中保存 AppSecret。

### 后端 API

```bash
pnpm dev:api
```

访问 `http://localhost:3000/`，返回：

```json
{
  "message": "Hello World"
}
```

### 运营管理后台

```bash
pnpm dev:admin
```

默认访问地址为 `http://localhost:5173/`。

## 构建

三个应用分别构建：

```bash
pnpm build:miniapp
pnpm build:api
pnpm build:admin
```

## 测试与类型检查

```bash
pnpm test
pnpm typecheck
```

训练目录和每组内容由 `@microly/content-schema` 在运行时分别校验；单组无效不会阻塞其他训练。训练进度、主动表达和 1/3/7/14 天复习队列保存在当前设备，不会上传到服务端。

## 产品文档

完整文档入口：[docs/product/README.md](./docs/product/README.md)

- [需求分析](./docs/product/01-requirements-analysis.md)
- [产品需求文档（PRD）](./docs/product/02-prd.md)
- [体验与内容设计](./docs/product/03-ux-content-design.md)
- [数据、AI 与指标设计](./docs/product/04-data-ai-metrics.md)
- [版本计划与验收](./docs/product/05-roadmap-acceptance.md)
