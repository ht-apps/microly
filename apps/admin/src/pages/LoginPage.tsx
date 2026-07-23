import { LockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useState } from 'react'

import { ApiError } from '../api'
import { useAuth } from '../auth'
import microlyMark from '../assets/microly-mark.png'

type LoginValues = { token: string }

export function LoginPage() {
  const { token, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  if (token) return <Navigate to={from} replace />
  const submit = async ({ token: value }: LoginValues) => {
    setError('')
    try {
      await login(value.trim())
      navigate(from, { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503
        ? 'API 尚未配置 ADMIN_API_TOKEN。'
        : '管理令牌无效，请重新输入。')
    }
  }
  return <main className="login-page">
    <Card className="login-card" variant="borderless">
      <img className="login-logo" src={microlyMark} alt="微习" />
      <Typography.Text className="eyebrow">MICROLY OPERATIONS</Typography.Text>
      <Typography.Title level={1}>进入运营后台</Typography.Title>
      <Typography.Paragraph type="secondary">使用本地 API 配置的共享管理令牌。令牌只在当前浏览器会话中保存。</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} />}
      <Form<LoginValues> layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="管理令牌" name="token" rules={[{ required: true, message: '请输入管理令牌' }, { min: 32, message: '管理令牌至少需要 32 位' }]}>
          <Input.Password autoFocus size="large" prefix={<LockOutlined />} placeholder="输入 ADMIN_API_TOKEN" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block>验证并进入</Button>
      </Form>
    </Card>
  </main>
}
