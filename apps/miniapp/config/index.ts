import { defineConfig } from '@tarojs/cli'

const apiBaseUrl = (process.env.TARO_APP_API_BASE_URL ?? '').trim()
const appVersion = (process.env.TARO_APP_VERSION ?? '1.0.0').trim()

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'vite'>({
  projectName: 'microly',
  date: '2026-7-22',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  env: {
    TARO_APP_API_BASE_URL: JSON.stringify(apiBaseUrl),
    TARO_APP_VERSION: JSON.stringify(appVersion)
  },
  copy: {
    patterns: [
      {
        from: 'src/assets/share/challenge-cover.png',
        to: 'dist/assets/share/challenge-cover.png'
      },
      {
        from: 'src/assets/brand/microly-mark.png',
        to: 'dist/assets/brand/microly-mark.png'
      }
    ],
    options: {}
  },
  plugins: ['@tarojs/plugin-generator'],
  framework: 'react',
  compiler: 'vite',
  mini: {
    postcss: {
      pxtransform: {
        enable: true
      }
    }
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    miniCssExtractPluginOption: {
      ignoreOrder: true,
      filename: 'css/[name].[hash].css',
      chunkFilename: 'css/[name].[chunkhash].css'
    },
    postcss: {
      autoprefixer: {
        enable: true
      }
    }
  }
})
