import { defineConfig } from '@tarojs/cli'

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
