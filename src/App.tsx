import { TourViewer } from './components/TourViewer'
import { demoTour } from './data/tour'

export default function App() {
  return <TourViewer tour={demoTour} />
}
