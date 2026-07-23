import { BarChartOutlined, CommentOutlined, DatabaseOutlined, ExperimentOutlined, LogoutOutlined } from '@ant-design/icons'
import { Button, Layout, Menu } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { useAuth } from '../auth'
import microlyMark from '../assets/microly-mark.png'

const { Content, Sider } = Layout

export function AdminLayout() {
  const { logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const selected = location.pathname.startsWith('/content') ? '/content'
    : location.pathname.startsWith('/feedback') ? '/feedback'
      : location.pathname.startsWith('/ai') ? '/ai' : '/dashboard'
  return <Layout className="admin-shell">
    <Sider breakpoint="lg" collapsedWidth={72} width={232} className="admin-sider">
      <div className="sidebar-brand">
        <img src={microlyMark} alt="微习" />
        <div className="sidebar-brand__copy"><strong>Microly</strong><span>运营后台</span></div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selected]}
        onClick={({ key }) => navigate(key)}
        items={[
          { key: '/dashboard', icon: <BarChartOutlined />, label: '数据概览' },
          { key: '/content', icon: <DatabaseOutlined />, label: '内容管理' },
          { key: '/feedback', icon: <CommentOutlined />, label: '反馈处理' },
          { key: '/ai', icon: <ExperimentOutlined />, label: 'AI 点评' },
        ]}
      />
      <Button className="sidebar-logout" type="text" icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/login', { replace: true }) }}>退出后台</Button>
    </Sider>
    <Layout><Content className="admin-content"><Outlet /></Content></Layout>
  </Layout>
}
