export default defineAppConfig({
  pages: [
    'pages/onboarding/index',
    'pages/index/index',
    'pages/course/index',
    'pages/profile/index',
    'pages/review/index',
    'pages/favorites/index',
    'pages/preferences/index',
    'pages/challenge/index',
    'pages/training/index',
    'pages/settings/index',
    'pages/privacy/index',
    'pages/ai-info/index',
    'pages/weekly-report/index',
    'pages/agreement/index',
    'pages/feedback/index'
  ],
  tabBar: {
    color: '#7e8290',
    selectedColor: '#5b5bd6',
    backgroundColor: '#fffaf2',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '今日',
        iconPath: 'assets/tabbar/today.png',
        selectedIconPath: 'assets/tabbar/today-selected.png'
      },
      {
        pagePath: 'pages/course/index',
        text: '课程',
        iconPath: 'assets/tabbar/course.png',
        selectedIconPath: 'assets/tabbar/course-selected.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tabbar/profile.png',
        selectedIconPath: 'assets/tabbar/profile-selected.png'
      }
    ]
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fffaf2',
    navigationBarTitleText: '微习',
    navigationBarTextStyle: 'black'
  }
})
