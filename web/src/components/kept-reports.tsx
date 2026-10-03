import { useLocation } from 'react-router'

import { REPORT_PAGES } from '@/app-pages'
import { useDesktop } from '@/components/desktop-gate'

export function KeptReports() {
  const desktop = useDesktop()
  const { pathname } = useLocation()
  if (desktop.status !== 'ready') return null

  return (
    <>
      {REPORT_PAGES.map(({ path, Page }) => (
        <div key={path} hidden={pathname !== path}>
          <Page />
        </div>
      ))}
    </>
  )
}
