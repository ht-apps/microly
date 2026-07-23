import { useEffect, type PropsWithChildren } from 'react'

import {
  bootstrapNetworkFeatures,
  initializeLocalNetworkState,
} from './features/network/bootstrap'

import './app.scss'

initializeLocalNetworkState()

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    void bootstrapNetworkFeatures()
  }, [])
  return children
}

export default App
