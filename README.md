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

小程序已包含首次引导与本地学习偏好，以及“职场沟通基础”本地课程。课程按顺序提供边界沟通、清晰汇报、表达异议和推动协作四个章节，共 10 组完整训练；同时支持自然日今日任务、本周进度、连续学习、跨章节课程进度、单组重练、本地错题复习和原则收藏。训练第 2～5 步可保留状态返回，完成后可只读回看本次训练，并可将不含个人答案的情景挑战分享给微信好友。“今日、课程、我的”通过原生 TabBar 组成主导航。API 和运营后台仍为 Hello World 工程。API 已安装 Zod、Drizzle ORM 和 PostgreSQL 驱动，但尚未配置数据库连接、Schema 或迁移。

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

课程库、章节目录和每组内容由 `@microly/content-schema` 在运行时分层校验；单章节或单组无效不会阻塞后续有效训练。训练按四章节全课程顺序解锁，学习偏好只标记重点章节，不跳过前置。已有本地训练记录的用户会自动跳过首次引导。学习偏好、训练进度、主动表达、原则收藏、学习活动和 1/3/7/14 天复习队列均保存在当前设备，不会上传到服务端。完成一组正式训练，或同一天完成至少两道到期复习，会形成一个有效学习日；本周按周一至周日统计。“我的”页面只展示能够从这些本地状态可靠计算的基础统计。

训练完成页支持微信原生好友分享。分享路径只包含训练组 ID 和固定来源标记，不携带分享者答案、主动表达、正确率或本地学习数据；接收方在独立挑战页作答，结果也不会写入训练与学习记录。H5 仅用于预览挑战页，实际分享需在微信小程序中使用。

## 产品文档

完整文档入口：[docs/product/README.md](./docs/product/README.md)

- [需求分析](./docs/product/01-requirements-analysis.md)
- [产品需求文档（PRD）](./docs/product/02-prd.md)
- [体验与内容设计](./docs/product/03-ux-content-design.md)
- [数据、AI 与指标设计](./docs/product/04-data-ai-metrics.md)
- [版本计划与验收](./docs/product/05-roadmap-acceptance.md)
