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
```

当前三个应用均为 Hello World 工程。API 已安装 Zod、Drizzle ORM 和 PostgreSQL 驱动，但尚未配置数据库连接、Schema 或迁移。

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

## 产品文档

完整文档入口：[docs/product/README.md](./docs/product/README.md)

- [需求分析](./docs/product/01-requirements-analysis.md)
- [产品需求文档（PRD）](./docs/product/02-prd.md)
- [体验与内容设计](./docs/product/03-ux-content-design.md)
- [数据、AI 与指标设计](./docs/product/04-data-ai-metrics.md)
- [版本计划与验收](./docs/product/05-roadmap-acceptance.md)
