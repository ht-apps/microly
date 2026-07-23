# Microly 运营后台

本地运营工具，使用 React 19、Vite 8、Ant Design 6、React Router 7、TanStack Query 5、Monaco Editor 和 Ant Design Charts。

## 启动

先启动 PostgreSQL、执行迁移并启动 API，然后在仓库根目录运行：

```bash
pnpm dev:admin
```

默认访问 `http://127.0.0.1:5173`，API 地址为 `http://127.0.0.1:3000`。需要覆盖时可配置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm dev:admin
```

登录使用 API 的 `ADMIN_API_TOKEN`。令牌只保存在浏览器 `sessionStorage`，关闭会话后需要重新输入。

## 验证

```bash
pnpm --filter @microly/admin lint
pnpm --filter @microly/admin test
pnpm --filter @microly/admin build
```

后台使用 Hash 路由，内容编辑器和指标图表按路由懒加载，不需要为部署配置 SPA rewrite。
