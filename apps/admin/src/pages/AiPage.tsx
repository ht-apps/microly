import { useEffect, useMemo, useState } from 'react'
import type { AdminAiModelConfig } from '@microly/api-contract'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Card, Col, Form, Input, InputNumber, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag } from 'antd'

import { adminApi } from '../api'
import { useAuth } from '../auth'
import { PageError, PageLoading } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

type FormValue = Omit<AdminAiModelConfig, 'id' | 'provider' | 'displayName' | 'active' | 'updatedAt'> & { reason: string }

export default function AiPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [window, setWindow] = useState<'7d' | '30d'>('7d')
  const [form] = Form.useForm<FormValue>()
  const config = useQuery({ queryKey: queryKeys.aiConfig, queryFn: () => adminApi.getAiConfig(token) })
  const metrics = useQuery({ queryKey: queryKeys.aiMetrics(window), queryFn: () => adminApi.getAiMetrics(token, window) })
  const selectedModelId = Form.useWatch('modelId', form)
  const thinkingEnabled = Form.useWatch('thinkingEnabled', form)
  const selectedModel = useMemo(() => config.data?.models.find((model) => model.modelId === selectedModelId), [config.data?.models, selectedModelId])

  useEffect(() => {
    const active = config.data?.models.find((model) => model.active)
    if (active) form.setFieldsValue({ ...active, reason: '' })
  }, [config.data, form])

  const refresh = useMutation({
    mutationFn: () => adminApi.refreshAiModels(token),
    onSuccess: (value) => { queryClient.setQueryData(queryKeys.aiConfig, value); void message.success('DeepSeek 模型列表已同步') },
    onError: (error: Error) => void message.error(error.message),
  })
  const save = useMutation({
    mutationFn: (value: FormValue) => adminApi.updateAiConfig(token, value),
    onSuccess: (value) => { queryClient.setQueryData(queryKeys.aiConfig, value); void queryClient.invalidateQueries({ queryKey: ['admin', 'ai-metrics'] }); void message.success('模型配置已启用') },
    onError: (error: Error) => void message.error(error.message),
  })

  const selectModel = (modelId: string) => {
    const model = config.data?.models.find((item) => item.modelId === modelId)
    if (model) form.setFieldsValue({ ...model, reason: '' })
  }

  if (config.isLoading) return <PageLoading rows={8} />
  if (config.isError) return <PageError onRetry={() => void config.refetch()} />
  return <section>
    <PageHeader eyebrow="模型运营" title="AI 点评" description="切换 DeepSeek 模型、控制额度，并观察结构化点评的质量、延迟和成本。" extra={<Button loading={refresh.isPending} onClick={() => refresh.mutate()}>同步模型</Button>} />
    {!config.data?.configured && <Alert type="warning" showIcon message="AI 尚未启用" description="请在 apps/api/.env.local 同时配置 DEEPSEEK_API_KEY 和 AI_INPUT_HASH_SECRET；公共 API 不受影响。" />}
    <Row gutter={[18, 18]} className="ai-admin-grid">
      <Col xs={24} xl={10}><Card title="运行配置" extra={config.data?.activeModelId ? <Tag color="purple">当前 {config.data.activeModelId}</Tag> : null}>
        <Form layout="vertical" form={form} onFinish={(value) => save.mutate(value)}>
          <Form.Item name="modelId" label="模型" rules={[{ required: true }]}><Select options={config.data?.models.map((model) => ({ label: model.displayName, value: model.modelId }))} onChange={selectModel} /></Form.Item>
          <Form.Item name="revision" hidden><InputNumber /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="thinkingEnabled" label="思考模式" valuePropName="checked"><Switch /></Form.Item></Col><Col span={12}><Form.Item name="dailyQuota" label="每日账号额度" rules={[{ required: true }]}><InputNumber min={1} max={100} className="full-width" /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="maxTokens" label="最大输出"><InputNumber min={100} max={4000} className="full-width" /></Form.Item></Col><Col span={8}><Form.Item name="temperature" label="温度"><InputNumber min={0} max={2} step={0.1} disabled={thinkingEnabled} className="full-width" /></Form.Item></Col><Col span={8}><Form.Item name="timeoutMs" label="超时 ms"><InputNumber min={5000} max={60000} step={1000} className="full-width" /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="inputCacheHitPrice" label="缓存命中 $/M"><InputNumber min={0} precision={6} className="full-width" /></Form.Item></Col><Col span={8}><Form.Item name="inputCacheMissPrice" label="输入 $/M"><InputNumber min={0} precision={6} className="full-width" /></Form.Item></Col><Col span={8}><Form.Item name="outputPrice" label="输出 $/M"><InputNumber min={0} precision={6} className="full-width" /></Form.Item></Col></Row>
          <Form.Item name="reason" label="变更原因" rules={[{ required: true, min: 3, max: 300 }]}><Input.TextArea rows={3} placeholder="说明切换模型或参数的原因" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={!selectedModel}>保存并启用</Button>
        </Form>
      </Card></Col>
      <Col xs={24} xl={14}><Space orientation="vertical" size="middle" className="full-width">
        <Segmented value={window} options={[{ label: '近 7 天', value: '7d' }, { label: '近 30 天', value: '30d' }]} onChange={(value) => setWindow(value as '7d' | '30d')} />
        {metrics.isLoading && <PageLoading rows={4} />}
        {metrics.data && <>
          <Row gutter={[12, 12]}>{[
            ['请求量', metrics.data.total], ['成功', metrics.data.byStatus.succeeded], ['降级', metrics.data.byStatus.degraded],
            ['P95 延迟', metrics.data.latencyP95 === null ? '-' : `${Math.round(metrics.data.latencyP95)} ms`],
            ['估算成本', `$${metrics.data.estimatedCostUsd.toFixed(4)}`], ['有帮助率', metrics.data.helpfulRate === null ? '-' : `${(metrics.data.helpfulRate * 100).toFixed(1)}%`],
          ].map(([title, value]) => <Col xs={12} md={8} key={title}><Card className="metric-card"><Statistic title={title} value={value} /></Card></Col>)}</Row>
          <Card title="模型调用分布"><Table size="small" pagination={false} rowKey="modelId" dataSource={metrics.data.models} columns={[{ title: '模型', dataIndex: 'modelId' }, { title: '调用数', dataIndex: 'count', width: 100 }]} /></Card>
        </>}
      </Space></Col>
    </Row>
  </section>
}
