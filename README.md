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
├── content-schema/  # 基于 Zod 的训练内容共享契约
├── training-content/ # 小程序与 API 共用的内置课程
└── api-contract/    # 联网接口请求与响应契约
```

小程序已包含首次引导、课程进度、间隔复习、原则收藏、学习统计、情景分享与四章 10 组训练。v0.3 在 PostgreSQL + Fastify 联网纵切上增加微信账号升级、跨设备学习同步、退出与注销、隐私说明和意见反馈。主动表达原文和本地规则点评始终只保存在设备。运营后台仍为 Hello World 工程。

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
TARO_APP_API_BASE_URL=http://127.0.0.1:3000
```

修改后需要重新启动 `pnpm dev:miniapp`。`TARO_APP_ID` 会覆盖构建产物 `apps/miniapp/dist/project.config.json`，但不会改写受版本控制的外层 `project.config.json`；不要在前端环境文件中保存 AppSecret。

### 后端 API

如需测试微信登录，先复制 API 环境变量示例，并在本机填入微信 AppID、AppSecret 和至少 32 位的随机摘要密钥：

```bash
cp apps/api/.env.example apps/api/.env.local
```

`.env.local` 已被 Git 忽略；不要将 AppSecret 放入小程序环境变量或提交到仓库。不创建该文件时，API 仍可提供内容、游客和同步功能，仅微信登录不可用。

首次启动时准备 PostgreSQL 和课程内容：

```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

启动 API：

```bash
pnpm dev:api
```

访问 `http://localhost:3000/health`，正常时返回：

```json
{
  "data": {
    "process": "ok",
    "database": "ok"
  }
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

API 集成测试使用独立的 `microly_test` 数据库：

```bash
pnpm db:test:up
pnpm test:integration:api
```

课程库、章节目录和每组内容由 `@microly/content-schema` 校验。远程内容不可用时依次回退到最近的已验证缓存和内置课程。配置 API 后，训练完成、学习偏好、收藏、复习、学习活动和安全进度会在游客账号下备份，微信登录后可跨设备恢复。主动表达原文、规则点评和界面临时状态不会上传。

训练完成页支持微信原生好友分享。分享路径只包含训练组 ID 和固定来源标记，不携带分享者答案、主动表达、正确率或本地学习数据；接收方在独立挑战页作答，结果也不会写入训练与学习记录。H5 仅用于预览挑战页，实际分享需在微信小程序中使用。

## 产品文档

完整文档入口：[docs/product/README.md](./docs/product/README.md)

- [需求分析](./docs/product/01-requirements-analysis.md)
- [产品需求文档（PRD）](./docs/product/02-prd.md)
- [体验与内容设计](./docs/product/03-ux-content-design.md)
- [数据、AI 与指标设计](./docs/product/04-data-ai-metrics.md)
- [版本计划与验收](./docs/product/05-roadmap-acceptance.md)
