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

小程序已包含首次引导、课程进度、间隔复习、原则收藏、学习统计、AI 表达点评、学习周报和情景分享。远程发布内容为四章 30 组训练，安装包继续保留原有 10 组离线兜底；用户复习时使用人工审核的变体，不会临时调用 AI 或消耗点评额度。

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

如需测试微信登录或运营后台，先复制 API 环境变量示例，并在本机填入微信配置、至少 32 位的身份摘要密钥和管理令牌：

```bash
cp apps/api/.env.example apps/api/.env.local
```

`.env.local` 已被 Git 忽略；不要将 AppSecret、DeepSeek API Key 或管理令牌提交到仓库。不配置微信字段时仅微信登录不可用；不配置 `ADMIN_API_TOKEN` 时仅管理接口不可用；AI 点评需要同时配置 `DEEPSEEK_API_KEY` 和至少 32 位的 `AI_INPUT_HASH_SECRET`。任何可选配置缺失都不会影响公共 API 和本地训练。

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
    "database": "ok",
    "content": "ok",
    "migrations": "ok",
    "version": "1.0.0"
  }
}
```

### 运营管理后台

```bash
pnpm dev:admin
```

默认访问地址为 `http://localhost:5173/`。输入 `apps/api/.env.local` 中的 `ADMIN_API_TOKEN`，令牌只保存在当前浏览器会话。后台 API 默认使用 `http://127.0.0.1:3000`，需要覆盖时执行：

```bash
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm dev:admin
```

后台支持查看 7/30 天学习漏斗、处理反馈，以及从当前或历史版本创建 JSON 草稿。发布前会使用共享 Schema 校验并预览六类训练卡片；发布、回滚和下架只生成更高的新版本，不修改历史快照。AI 点评页可同步 DeepSeek 模型、切换当前模型、调整额度与参数，并查看用户点评和内容候选生成的聚合质量与成本指标。

“封测发布”页提供 API、数据库、内容和 AI 状态、运行开关、部署与备份历史、发布阻断清单，以及按安全指纹聚合的客户端错误。小程序错误报告不会包含错误正文、原始堆栈、主动表达、token 或请求参数；用户可在“账号与设置 → 诊断信息”查看本机诊断状态。

## 单机封测部署

复制生产环境模板并替换域名、数据库密码、微信密钥和管理令牌：

```bash
cp .env.production.example .env.production
pnpm prod:check
```

API 与后台域名必须提前解析到部署主机。发布命令会执行全仓检查、构建不可变镜像、发布前备份、迁移、健康检查和版本登记：

```bash
pnpm prod:release
```

生产 Compose 只公开 Caddy 的 80/443 端口，PostgreSQL 位于内部网络。Caddy 自动申请 HTTPS 证书；后台使用独立域名并继续通过会话级管理令牌认证。应用回滚不会覆盖数据库：

```bash
pnpm prod:rollback -- 1.0.0
```

备份默认写入 `BACKUP_HOST_DIR`，保留 14 个日备份和 8 个周备份。恢复演练只操作隔离的 `microly_restore` 数据库：

```bash
pnpm prod:backup
pnpm prod:backup:status
pnpm prod:restore:test -- backups-production/microly-时间.dump
pnpm prod:build:miniapp
```

小程序生产构建必须显式设置 `TARO_APP_API_BASE_URL=https://你的API域名` 和 `TARO_APP_VERSION=x.y.z`，随后通过微信开发者工具手动上传体验版。

生成复习变体时，在内容草稿中选择训练并点击“生成变体”。候选只会显示在确认窗口中，不会自动修改草稿；选择 1～3 条插入编辑器后，仍需依次保存、校验并发布。每组训练最多发布 5 个变体。DeepSeek 未配置时可以继续手工编辑 `reviewVariants`，不会影响内容发布或小程序复习。

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

封测发布前运行完整检查；配置 `DATABASE_URL` 时会额外核对迁移状态：

```bash
pnpm preflight
pnpm db:backup
pnpm db:restore:test -- backups/你的备份.dump
```

恢复命令只允许写入 Docker 隔离测试库 `microly_test`。详细流程见 [封测发布与故障处理清单](./docs/product/06-beta-operations-checklist.md)。

API 集成测试使用独立的 `microly_test` 数据库：

```bash
pnpm db:test:up
pnpm test:integration:api
```

仓库包含 100 条匿名合成 AI 评测样本。真实 DeepSeek 回归不会被普通测试触发；确认 Key、费用与样本数量后显式执行：

```bash
DEEPSEEK_API_KEY=你的本地密钥 AI_EVAL_LIMIT=20 pnpm eval:ai
```

课程库、章节目录、训练和复习变体由 `@microly/content-schema` 校验。远程内容不可用时依次回退到最近的已验证缓存和内置课程。配置 API 后，训练完成、学习偏好、收藏、复习、学习活动和安全进度会在游客账号下备份，微信登录后可跨设备恢复。复习继续使用 1/3/7/14 天调度，并按“变体、原题、下一变体、原题”稳定轮换；没有变体时始终使用原题。

“今日”和“我的”均可进入学习周报。周报完全由本机或已同步的结构化学习数据确定性生成，支持当前周及最近 8 个自然周，不调用模型；数据不足时不会虚构正确率、优势或薄弱项。主动表达原文只保存在设备；仅在用户明确请求 AI 点评时发送给 DeepSeek，微习服务端只保存不可逆摘要和经过校验的结构化结果，不保存原文或写入离线重试队列。

训练完成页支持微信原生好友分享。分享路径只包含训练组 ID 和固定来源标记，不携带分享者答案、主动表达、正确率或本地学习数据；接收方在独立挑战页作答，结果也不会写入训练与学习记录。H5 仅用于预览挑战页，实际分享需在微信小程序中使用。

## 产品文档

完整文档入口：[docs/product/README.md](./docs/product/README.md)

- [需求分析](./docs/product/01-requirements-analysis.md)
- [产品需求文档（PRD）](./docs/product/02-prd.md)
- [体验与内容设计](./docs/product/03-ux-content-design.md)
- [数据、AI 与指标设计](./docs/product/04-data-ai-metrics.md)
- [版本计划与验收](./docs/product/05-roadmap-acceptance.md)
