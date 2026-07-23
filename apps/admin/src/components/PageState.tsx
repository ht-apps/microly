import { Button, Result, Skeleton } from 'antd'

export function PageLoading({ rows = 5 }: { rows?: number }) {
  return <div className="page-state"><Skeleton active paragraph={{ rows }} /></div>
}

export function PageError({ onRetry }: { onRetry: () => void }) {
  return <Result status="error" title="内容加载失败" subTitle="请检查 API 服务和管理令牌后重试。" extra={<Button type="primary" onClick={onRetry}>重新加载</Button>} />
}
