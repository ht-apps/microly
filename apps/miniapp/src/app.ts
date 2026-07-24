import { useEffect, type PropsWithChildren } from 'react'

import {
  bootstrapNetworkFeatures,
  initializeLocalNetworkState,
} from './features/network/bootstrap'
import { installClientErrorCapture } from './features/diagnostics/client-errors'

import './app.scss'

initializeLocalNetworkState()
installClientErrorCapture()

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    void bootstrapNetworkFeatures()
  }, [])
  return children
}

export default App
