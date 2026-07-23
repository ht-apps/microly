import type { ThemeConfig } from 'antd'

export const microlyTheme: ThemeConfig = {
  token: {
    colorPrimary: '#5b5bd6',
    colorInfo: '#5b5bd6',
    colorSuccess: '#2f9b72',
    colorWarning: '#d89a26',
    colorError: '#c9455d',
    borderRadius: 12,
    borderRadiusLG: 18,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    colorBgLayout: '#f5f6fa',
  },
  components: {
    Layout: { siderBg: '#202039', headerBg: '#ffffff' },
    Menu: { darkItemBg: '#202039', darkItemSelectedBg: '#ffffff18', darkItemHoverBg: '#ffffff10' },
    Card: { paddingLG: 22 },
    Table: { headerBg: '#f7f7fa' },
  },
}
