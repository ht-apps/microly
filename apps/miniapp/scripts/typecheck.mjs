import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDirectory, '..')
const configPath = path.join(appRoot, 'tsconfig.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => appRoot,
    getNewLine: () => ts.sys.newLine,
  }))
  process.exit(1)
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  appRoot,
  { noEmit: true, skipLibCheck: true },
  configPath,
)
const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
  projectReferences: parsedConfig.projectReferences,
})

// Taro 4.2.1 publishes declarations for every supported platform. Some of
// those optional declarations reference packages that are intentionally not
// installed in this WeChat-only app, so only project-owned diagnostics decide
// whether this check passes. External declarations remain covered by Taro's
// own build and the app's H5/weapp compilation checks.
const projectDiagnostics = ts.getPreEmitDiagnostics(program).filter(
  (diagnostic) => diagnostic.file
    && path.resolve(diagnostic.file.fileName).startsWith(`${appRoot}${path.sep}`)
    && !diagnostic.file.fileName.includes(`${path.sep}node_modules${path.sep}`),
)
const diagnostics = [...parsedConfig.errors, ...projectDiagnostics]

if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => appRoot,
    getNewLine: () => ts.sys.newLine,
  }))
  process.exit(1)
}

console.log('小程序项目源码类型检查通过。')
